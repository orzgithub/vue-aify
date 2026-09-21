//! AIfy MCP bridge — Rust implementation.
//!
//! Run the binary as an MCP server over stdio while it also listens for page
//! WebSocket connections and (optionally) provides the demo HTTP compatibility
//! API.

pub mod bridge;
pub mod http;
pub mod mcp;
pub mod ticket;
pub mod ws;
