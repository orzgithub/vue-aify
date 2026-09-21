# vue-ui-agentify

Three independent subprojects that together make a GUI AI-native. Each folder
owns its package manager files, source, and dependencies.

```
aify/   Vue 3 library + framework-agnostic core + browser transport
mcp/    MCP bridge (Rust binary)
demo/   Runnable Vue demo consuming aify + the Rust bridge
```

## aify

The reusable control layer. It exposes a page/action directive graph and the
five fixed tools `map / routine / snapshot / act / wait_for_ui`; it never sends
arbitrary JavaScript and never manages focus/routing itself.

```bash
cd aify
npm install
npm test
npm run typecheck
npm run build
```

## mcp

The Rust bridge that exposes the five tools to an AI host and accepts WebSocket
connections from a page. Service mode provides MCP HTTP+SSE (`/sse` +
`/messages`), Streamable HTTP (`/streamable`), and plain HTTP JSON-RPC
(`/http`); stdio mode provides MCP over stdio.

```bash
cd mcp
cargo build --release
cargo test
```

Run it with:

```bash
# Service mode (default): /sse, /streamable, /http + WS :7799
cargo run --release
cargo run --release -- server

# Stdio mode: MCP over stdio + WS :7799
cargo run --release -- stdio
```

## demo

A complete login → home → logout-confirm flow. It consumes `aify` as a local
`file:` package dependency and runs the Rust bridge with `cargo`.

```bash
cd demo
npm install
npm run dev        # terminal A: Vite page
npm run host       # terminal B: WS :7799 + HTTP :7798
npm run agent      # terminal C: drive the five tools
```

See `demo/README.md` for the connection-ticket flow and exact tool calls.
