//! WebSocket entrypoint for pages. Mirrors the TypeScript `socketPlane` logic:
//! the page registers with a ticket token, then answers request ids.
//!
//! Close-code contract (consumed by the page transport's reconnect policy):
//!   - 4000 "invalid ticket": the token was rejected / unknown (wrong key, or
//!     the store removed it). The page must STOP and ask the human to repaste —
//!     retrying with the same credential is pointless.
//!   - 1000 "bridge closed": graceful shutdown (e.g. the host was stopped).
//!   - no code / 1006: the socket dropped mid-session (transient); the page
//!     retries with backoff.
//! On a successful register the page is sent a `registered` text frame so it
//! can mark the session live (a drop before that ack is a fatal handshake
//! failure, not a transient drop).

use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use crate::bridge::{Bridge, PlaneHandle};
use crate::ticket::{random_token, TicketStore};

/// Custom close code: the page's credential was rejected. Must match the
/// `FATAL_CLOSE_CODE` constant in `aify/src/transport/websocket.ts`.
const INVALID_TICKET_CODE: u16 = 4000;

pub async fn serve_ws(
    addr: SocketAddr,
    bridge: Arc<Bridge>,
    tickets: Arc<TicketStore>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    eprintln!("[mcp] WebSocket listening on ws://{addr}");

    loop {
        let (stream, peer) = listener.accept().await?;
        let bridge = bridge.clone();
        let tickets = tickets.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_connection(stream, bridge, tickets).await {
                eprintln!("[mcp] page connection error from {peer}: {err:#}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    bridge: Arc<Bridge>,
    tickets: Arc<TicketStore>,
) -> anyhow::Result<()> {
    let ws = tokio_tungstenite::accept_async(stream).await?;
    let (mut sink, mut stream) = ws.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();

    let mut plane: Option<Arc<PlaneHandle>> = None;
    loop {
        tokio::select! {
            // Outbound frames from the plane (responses / extra) → Text.
            maybe = out_rx.recv() => {
                match maybe {
                    Some(value) => {
                        let text = value.to_string();
                        if sink.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break, // all senders dropped
                }
            }
            // Inbound frames from the page.
            maybe = stream.next() => {
                let message = match maybe {
                    Some(Ok(m)) => m,
                    Some(Err(err)) => {
                        eprintln!("[mcp] websocket read error: {err}");
                        break;
                    }
                    None => break,
                };

                match message {
                    Message::Text(text) => {
                        let value: Value = match serde_json::from_str(text.as_ref()) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };

                        if value.get("type").and_then(Value::as_str) == Some("register") {
                            let token = value.get("token").and_then(Value::as_str).unwrap_or("");
                            if !tickets.is_valid(token) {
                                eprintln!("[mcp] rejected page registration: invalid/expired token");
                                // Tell the page WHY, then hang up. The page maps
                                // 4000 to a fatal "wrong key" state, no retry.
                                let _ = sink.send(Message::Close(Some(CloseFrame {
                                    code: INVALID_TICKET_CODE.into(),
                                    reason: "invalid ticket".into(),
                                }))).await;
                                break;
                            }
                            let id = format!("web:{}", random_token().chars().take(6).collect::<String>());
                            let kind = value
                                .get("kind")
                                .and_then(Value::as_str)
                                .unwrap_or("web")
                                .to_string();
                            let handle = Arc::new(PlaneHandle::new(id.clone(), kind, out_tx.clone()));
                            bridge.register(handle.clone()).await;
                            eprintln!("[mcp] page connected: {id}");
                            plane = Some(handle);
                            // Ack so the page can mark the session live.
                            let _ = out_tx.send(json!({ "type": "registered", "id": id }));
                            continue;
                        }

                        if let Some(plane) = &plane {
                            plane.route_response(value);
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    if let Some(plane) = plane {
        plane.close("page disconnected");
        bridge.unregister(&plane.id).await;
        eprintln!("[mcp] page gone: {}", plane.id);
    }
    // Best-effort graceful close so the page distinguishes this from a 1006 drop.
    let _ = sink
        .send(Message::Close(Some(CloseFrame {
            code: 1000u16.into(),
            reason: "bridge closed".into(),
        })))
        .await;
    let _ = sink.close().await;
    Ok(())
}

/// Small helper used by the HTTP compatibility endpoint and tests.
pub fn register_message(token: &str, kind: &str) -> Value {
    json!({ "type": "register", "token": token, "kind": kind })
}
