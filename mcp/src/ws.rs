//! WebSocket entrypoint for pages. Mirrors the TypeScript `socketPlane` logic:
//! the page registers with a ticket token, then answers request ids.

use std::net::SocketAddr;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::bridge::{Bridge, PlaneHandle};
use crate::ticket::{random_token, TicketStore};

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

    let writer = tokio::spawn(async move {
        while let Some(message) = out_rx.recv().await {
            let text = message.to_string();
            if sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    let mut plane: Option<Arc<PlaneHandle>> = None;
    while let Some(message) = stream.next().await {
        let message = match message {
            Ok(m) => m,
            Err(err) => {
                eprintln!("[mcp] websocket read error: {err}");
                break;
            }
        };

        match message {
            Message::Text(text) => {
                let value: Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                if value.get("type").and_then(Value::as_str) == Some("register") {
                    let token = value.get("token").and_then(Value::as_str).unwrap_or("");
                    if !tickets.is_valid(token) {
                        eprintln!("[mcp] rejected page registration: invalid/expired token");
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

    if let Some(plane) = plane {
        plane.close("page disconnected");
        bridge.unregister(&plane.id).await;
        eprintln!("[mcp] page gone: {}", plane.id);
    }
    writer.abort();
    Ok(())
}

/// Small helper used by the HTTP compatibility endpoint and tests.
pub fn register_message(token: &str, kind: &str) -> Value {
    json!({ "type": "register", "token": token, "kind": kind })
}
