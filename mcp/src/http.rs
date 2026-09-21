//! HTTP service mode: MCP endpoints + the demo compatibility API.
//!
//! Endpoints:
//!   GET  /sse         legacy HTTP+SSE MCP transport
//!   POST /messages    legacy HTTP+SSE MCP client-to-server messages
//!   POST /streamable  Streamable HTTP MCP transport (JSON responses)
//!   GET  /streamable  Streamable HTTP GET (405: no server-initiated stream)
//!   POST /http        plain HTTP JSON-RPC MCP endpoint
//!   GET  /ticket.json demo connection-ticket JSON
//!   POST /            demo compatibility API

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock};

use crate::bridge::Bridge;
use crate::mcp::handle_message;
use crate::ticket::{random_token, ConnectTicket};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone)]
struct HttpState {
    bridge: Arc<Bridge>,
    ticket: Arc<ConnectTicket>,
    sessions: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<Value>>>>,
}

pub async fn serve_http(
    addr: SocketAddr,
    bridge: Arc<Bridge>,
    ticket: Arc<ConnectTicket>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    eprintln!("[mcp] HTTP service listening on http://{addr}  (/sse, /streamable, /http)");

    let state = HttpState {
        bridge,
        ticket,
        sessions: Arc::new(RwLock::new(HashMap::new())),
    };

    loop {
        let (stream, _peer) = listener.accept().await?;
        let state = state.clone();
        tokio::spawn(async move {
            if let Err(err) = handle_http(stream, state).await {
                eprintln!("[mcp] HTTP error: {err:#}");
            }
        });
    }
}

async fn handle_http(mut stream: TcpStream, state: HttpState) -> anyhow::Result<()> {
    let Some(request) = read_request(&mut stream).await? else {
        return Ok(());
    };

    let first_line = request.head.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("/");
    let (path, query) = split_target(target);

    match (method, path) {
        ("GET", "/ticket.json") => {
            write_json(&mut stream, 200, &serde_json::to_value(&*state.ticket)?).await
        }

        // Legacy MCP HTTP+SSE transport.
        ("GET", "/sse") => handle_sse(stream, state).await,
        ("POST", "/messages") => handle_sse_post(stream, state, &query, request.body).await,

        // Streamable HTTP MCP transport. POST gets a JSON response; GET is
        // explicitly unsupported at this endpoint (allowed by the MCP spec).
        ("POST", "/streamable") => handle_mcp_post(stream, state, request.body).await,
        ("GET", "/streamable") => {
            write_status(
                &mut stream,
                405,
                "Method Not Allowed",
                Some("POST, DELETE"),
                b"",
            )
            .await
        }
        ("DELETE", "/streamable") => write_status(&mut stream, 204, "No Content", None, b"").await,

        // Plain HTTP JSON-RPC MCP endpoint.
        ("POST", "/http") => handle_mcp_post(stream, state, request.body).await,
        ("GET", "/http") => {
            write_status(&mut stream, 405, "Method Not Allowed", Some("POST"), b"").await
        }

        // Demo compatibility API used by demo/host/agent.ts.
        ("POST", "/") => handle_demo_post(stream, state, request.body).await,
        ("GET", "/") => {
            let body = b"AIfy Rust bridge\n\
                         MCP: GET /sse, POST /messages, POST /streamable, POST /http\n\
                         Demo: GET /ticket.json, POST / {method,params}\n";
            write_status(&mut stream, 200, "OK", None, body).await
        }

        _ => write_status(&mut stream, 404, "Not Found", None, b"not found\n").await,
    }
}

// ---- Legacy HTTP+SSE MCP transport ---------------------------------------

async fn handle_sse(mut stream: TcpStream, state: HttpState) -> anyhow::Result<()> {
    let session_id: String = random_token().chars().take(12).collect();
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    state.sessions.write().await.insert(session_id.clone(), tx);

    let headers = "HTTP/1.1 200 OK\r\n\
                   Content-Type: text/event-stream\r\n\
                   Cache-Control: no-cache\r\n\
                   Connection: keep-alive\r\n\
                   \r\n";
    stream.write_all(headers.as_bytes()).await?;
    write_sse_event(
        &mut stream,
        "endpoint",
        &format!("/messages?sessionId={session_id}"),
    )
    .await?;

    while let Some(message) = rx.recv().await {
        let data = serde_json::to_string(&message)?;
        if write_sse_event(&mut stream, "message", &data)
            .await
            .is_err()
        {
            break;
        }
    }

    state.sessions.write().await.remove(&session_id);
    Ok(())
}

async fn handle_sse_post(
    mut stream: TcpStream,
    state: HttpState,
    query: &HashMap<String, String>,
    body: Vec<u8>,
) -> anyhow::Result<()> {
    let Some(session_id) = query.get("sessionId") else {
        return write_json(
            &mut stream,
            400,
            &json!({ "jsonrpc": "2.0", "error": { "code": -32600, "message": "missing sessionId" } }),
        )
        .await;
    };
    let sender = state.sessions.read().await.get(session_id).cloned();
    let Some(sender) = sender else {
        return write_json(
            &mut stream,
            404,
            &json!({ "jsonrpc": "2.0", "error": { "code": -32000, "message": "unknown session" } }),
        )
        .await;
    };

    let request: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return write_json(
                &mut stream,
                400,
                &json!({ "jsonrpc": "2.0", "error": { "code": -32700, "message": "parse error" } }),
            )
            .await;
        }
    };
    for response in collect_responses(&state.bridge, request).await {
        let _ = sender.send(response);
    }
    write_status(&mut stream, 202, "Accepted", None, b"").await
}

// ---- MCP over plain HTTP / Streamable HTTP POST ---------------------------

async fn handle_mcp_post(
    mut stream: TcpStream,
    state: HttpState,
    body: Vec<u8>,
) -> anyhow::Result<()> {
    let request: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return write_json(
                &mut stream,
                200,
                &json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "parse error" } }),
            )
            .await;
        }
    };
    let is_batch = request.is_array();
    let responses = collect_responses(&state.bridge, request).await;

    if responses.is_empty() {
        // Only notifications were sent.
        return write_status(&mut stream, 202, "Accepted", None, b"").await;
    }

    let response = if is_batch {
        Value::Array(responses)
    } else {
        responses.into_iter().next().unwrap_or(Value::Null)
    };
    write_json(&mut stream, 200, &response).await
}

async fn collect_responses(bridge: &Bridge, request: Value) -> Vec<Value> {
    match request {
        Value::Array(items) => {
            let mut responses = Vec::new();
            for item in items {
                if let Some(response) = handle_message(bridge, item).await {
                    responses.push(response);
                }
            }
            responses
        }
        other => handle_message(bridge, other).await.into_iter().collect(),
    }
}

// ---- Demo compatibility endpoint ------------------------------------------

async fn handle_demo_post(
    mut stream: TcpStream,
    state: HttpState,
    body: Vec<u8>,
) -> anyhow::Result<()> {
    if state.bridge.target_count().await == 0 {
        return write_json(
            &mut stream,
            200,
            &json!({ "jsonrpc": "2.0", "error": { "message": "no page connected" } }),
        )
        .await;
    }

    let call: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(_) => {
            return write_json(
                &mut stream,
                200,
                &json!({ "jsonrpc": "2.0", "error": { "message": "invalid JSON body" } }),
            )
            .await;
        }
    };
    let tool = call.get("method").and_then(Value::as_str).unwrap_or("");
    let params = call.get("params").cloned().unwrap_or(json!({}));

    match state.bridge.call_tool(tool, &params).await {
        Ok(result) => {
            write_json(
                &mut stream,
                200,
                &json!({ "jsonrpc": "2.0", "result": result }),
            )
            .await
        }
        Err(err) => {
            write_json(
                &mut stream,
                200,
                &json!({ "jsonrpc": "2.0", "error": { "message": err } }),
            )
            .await
        }
    }
}

// ---- HTTP parsing/writing helpers -----------------------------------------

struct HttpRequest {
    head: String,
    body: Vec<u8>,
}

fn split_target(target: &str) -> (&str, HashMap<String, String>) {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mut params = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        params.insert(key.to_string(), value.to_string());
    }
    (path, params)
}

async fn read_request(stream: &mut TcpStream) -> anyhow::Result<Option<HttpRequest>> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];

    let header_end = loop {
        if buffer.len() > MAX_REQUEST_BYTES {
            return Ok(None);
        }
        if let Some(pos) = find_bytes(&buffer, b"\r\n\r\n") {
            break pos;
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let content_length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    while buffer.len() < body_start + content_length {
        if buffer.len() > MAX_REQUEST_BYTES {
            return Ok(None);
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    let body_end = (body_start + content_length).min(buffer.len());
    Ok(Some(HttpRequest {
        head,
        body: buffer[body_start..body_end].to_vec(),
    }))
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

async fn write_sse_event(stream: &mut TcpStream, event: &str, data: &str) -> std::io::Result<()> {
    stream
        .write_all(format!("event: {event}\ndata: {data}\n\n").as_bytes())
        .await
}

async fn write_json(stream: &mut TcpStream, status: u16, value: &Value) -> anyhow::Result<()> {
    let body = serde_json::to_vec(value)?;
    write_status(
        stream,
        status,
        status_reason(status),
        Some("application/json"),
        &body,
    )
    .await
}

async fn write_status(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: Option<&str>,
    body: &[u8],
) -> anyhow::Result<()> {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    if let Some(content_type) = content_type {
        head.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    head.push_str("Connection: close\r\n\r\n");
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body).await?;
    Ok(())
}

fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    }
}
