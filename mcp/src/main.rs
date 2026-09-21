use std::net::SocketAddr;
use std::sync::Arc;

use aify_mcp::bridge::Bridge;
use aify_mcp::http::serve_http;
use aify_mcp::mcp::run_stdio;
use aify_mcp::ticket::{encode_ticket, issue_ticket, IssueTicketOptions, TicketStore};
use aify_mcp::ws::serve_ws;
use clap::{Parser, ValueEnum};

#[derive(Clone, Copy, Debug, Default, ValueEnum)]
enum Mode {
    /// HTTP service mode: /sse, /streamable, /http (+ demo compatibility API).
    #[default]
    Server,
    /// MCP over stdio (local process transport).
    Stdio,
}

#[derive(Debug, Parser)]
#[command(name = "aify-mcp", version, about = "AIfy MCP bridge (Rust)")]
struct Args {
    /// Mode: `server` (default) or `stdio`.
    #[arg(value_enum, default_value_t = Mode::Server)]
    mode: Mode,

    /// Interface for the WebSocket + HTTP servers.
    #[arg(long, default_value = "127.0.0.1")]
    host: String,

    /// WebSocket port pages connect to.
    #[arg(long, default_value_t = 7799)]
    ws_port: u16,

    /// HTTP service port (MCP endpoints + demo compatibility).
    #[arg(long, default_value_t = 7798)]
    http_port: u16,

    /// Legacy hardcoded token accepted in addition to the issued ticket.
    #[arg(long)]
    token: Option<String>,

    /// Optional ticket lifetime in seconds. Omit for a non-expiring ticket.
    #[arg(long)]
    ticket_ttl_seconds: Option<u64>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let bridge = Arc::new(Bridge::new());
    let tickets = Arc::new(TicketStore::new());

    let ticket = issue_ticket(IssueTicketOptions {
        host: Some(args.host.clone()),
        port: Some(args.ws_port),
        kind: Some("web".to_string()),
        ttl_ms: args
            .ticket_ttl_seconds
            .map(|seconds| seconds.saturating_mul(1_000)),
        ..Default::default()
    });
    tickets.add(ticket.token.clone(), ticket.expires_at);
    if let Some(token) = &args.token {
        tickets.add(token.clone(), None);
    }

    let credential = encode_ticket(&ticket)?;

    let ws_addr: SocketAddr = format!("{}:{}", args.host, args.ws_port).parse()?;
    let ws_bridge = bridge.clone();
    let ws_tickets = tickets.clone();
    tokio::spawn(async move {
        if let Err(err) = serve_ws(ws_addr, ws_bridge, ws_tickets).await {
            eprintln!("[mcp] WebSocket server stopped: {err:#}");
        }
    });

    match args.mode {
        Mode::Server => {
            let http_addr: SocketAddr = format!("{}:{}", args.host, args.http_port).parse()?;
            let http_bridge = bridge.clone();
            let http_ticket = Arc::new(ticket.clone());
            tokio::spawn(async move {
                if let Err(err) = serve_http(http_addr, http_bridge, http_ticket).await {
                    eprintln!("[mcp] HTTP server stopped: {err:#}");
                }
            });

            eprintln!("[mcp] connection credential (paste into the page):");
            eprintln!("      {credential}");
            eprintln!(
                "[mcp] service mode: http://{}:{}  (MCP: /sse, /streamable, /http)",
                args.host, args.http_port
            );
            eprintln!(
                "[mcp] ticket JSON: http://{}:{}/ticket.json",
                args.host, args.http_port
            );
            eprintln!("[mcp] page WebSocket: ws://{}:{}", args.host, args.ws_port);

            tokio::signal::ctrl_c().await?;
            Ok(())
        }
        Mode::Stdio => {
            eprintln!("[mcp] connection credential (paste into the page):");
            eprintln!("      {credential}");
            eprintln!("[mcp] page WebSocket: ws://{}:{}", args.host, args.ws_port);
            eprintln!("[mcp] MCP server ready on stdio");
            run_stdio(bridge).await
        }
    }
}
