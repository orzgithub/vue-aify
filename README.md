# vue-ui-agentify

Four independent subprojects that together make a GUI AI-native. Each folder
owns its package manager files, source, and dependencies. `lab/` is a
local-only playground and is gitignored; the publishable projects are `aify/`,
`mcp/`, and `demo/`.

```
aify/   Vue 3 library + framework-agnostic core + browser transport
mcp/    MCP bridge (Rust binary)
demo/   Runnable Vue demo consuming vue-aify + the Rust bridge
lab/    local-only manual test lab (gitignored)
```

## aify

The reusable control layer. It exposes a page/action directive graph and the
five fixed tools `map / routine / snapshot / act / wait_for_ui`; it never sends
arbitrary JavaScript and never manages focus/routing itself.

```bash
cd aify
npm install
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

A complete login → home → logout-confirm flow, plus the declared failure branch
`login → login-error → login`. The demo credentials are `admin` /
`demoP@ssw0rd`; any other pair takes the failure branch. It consumes `vue-aify`
as a local `file:` package dependency and runs the Rust bridge with `cargo`.

The demo uses `vue-router` hash routes (`#/login`, `#/login-error`, `#/home`)
whose names match the static page ids, so the URL is the source of truth for the
focused page: direct links and browser back/forward both work, and `act`-driven
transitions update the address bar.

```bash
cd demo
npm install
npm run dev        # terminal A: Vite page
npm run host       # terminal B: WS :7799 + HTTP :7798
npm run agent      # terminal C: drive the five tools
```

See `demo/README.md` for the connection-ticket flow and exact tool calls.

## lab

A local-only playground for experiments that should not be pushed. It is listed
in `.gitignore`; `demo/` is the publishable demo.

```bash
cd lab
npm install
npm run dev        # http://localhost:5174
```
