# aify-mcp

The MCP bridge between an AI host and an `aify` page/desktop plane.

The implementation is **Rust**, so it can be built and distributed as a
standalone binary. It exposes exactly five tools:
`map / routine / snapshot / act / wait_for_ui`.

The bridge never executes JavaScript and never decides focus/routing itself. It
only forwards tool calls to the connected page and returns whatever the page
reports.

## Build

```bash
cargo build --release
```

The binary is `target/release/aify-mcp`.

## Modes

### Service mode (default)

```bash
# No argument, or explicitly `server`
cargo run --release
cargo run --release -- server

# Custom ports / interface
cargo run --release -- server --host 127.0.0.1 --ws-port 7799 --http-port 7798
```

Starts HTTP MCP endpoints plus the page WebSocket listener.

| Endpoint | Transport |
|---|---|
| `GET /sse` + `POST /messages?sessionId=...` | legacy MCP HTTP+SSE |
| `POST /streamable` / `GET /streamable` / `DELETE /streamable` | MCP Streamable HTTP |
| `POST /http` | plain HTTP JSON-RPC MCP |
| `GET /ticket.json` | demo connection ticket |
| `POST /` `{method, params}` | demo compatibility API |

For Streamable HTTP, `POST` returns a JSON-RPC response directly; `GET` returns
`405` because this server does not offer a server-initiated SSE stream; `DELETE`
returns `204`. This is compliant with the Streamable HTTP transport spec.

For legacy HTTP+SSE, the client opens `GET /sse`, receives an `endpoint` event
containing `/messages?sessionId=...`, then POSTs JSON-RPC messages there. The
server streams the responses back over the original SSE connection.

### Stdio mode

```bash
cargo run --release -- stdio
```

Starts MCP over stdio, plus the page WebSocket listener. Stdout is reserved for
newline-delimited JSON-RPC; logs go to stderr. This is the local-process
transport used by AI hosts that launch an MCP server as a child process.

## Connection ticket

On startup, stderr prints:

- the base64 connection credential to paste into the page;
- the operator ticket JSON URL (`GET /ticket.json` in service mode).

`--ticket-ttl-seconds` sets an optional credential lifetime;
`--token <value>` also accepts a legacy hardcoded token.

## MCP tools

| Tool | Arguments | Result |
|---|---|---|
| `map` | — | `{ pages: [...] }` |
| `routine` | `{ node? }` | `{ edges: [{from,to,via,label?,when?,sideEffects?,outcome?}] }` |
| `snapshot` | — | `{ focused, page }` (page tree contains `action`/`module`/`text` nodes) |
| `act` | `{ actionId, value? }` | `{ ok, outcome?, transitionsTo?, sideEffects?, error? }` |
| `wait_for_ui` | `{ timeoutMs? }` | `{ ready, reason? }` |

## Rust layout

```
src/
  main.rs        CLI modes + startup wiring
  lib.rs         crate public modules
  ticket.rs      ticket format, random token, token allow-list
  bridge.rs      target registry + OperationPlane-over-WebSocket calls
  ws.rs          WebSocket page connections and response routing
  mcp.rs         MCP JSON-RPC handling + tool schemas
  http.rs        /sse, /messages, /streamable, /http + demo API
```

## MCP transport notes

- **stdio** is supported in `stdio` mode.
- **HTTP+SSE** is supported at `/sse` + `/messages`.
- **Streamable HTTP** is supported at `/streamable` with JSON responses.
- `/http` is a plain one-shot HTTP JSON-RPC endpoint for clients that do not
  implement either of the two HTTP MCP transports.
- The WebSocket listener on `:7799` is **not** an MCP transport; it is the
  project-specific page/bridge channel.

`initialize` echoes the client's `protocolVersion`; the default is
`2025-06-18`.

## Test

```bash
cargo test
```
