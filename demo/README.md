# AIfy DEMO — AI-native control layer (Vue)

A runnable demo of the `aify` Vue plugin and the Rust MCP bridge. The agent
never scrapes the DOM or screenshots: it pulls the GUI's operable elements +
text as **data** via the fixed tools
(`map` / `routine` / `snapshot` / `act` / `wait_for_ui`) and drives the page by
element ID through exactly two action types (`click` / `input`).

This folder is an independent subproject. It consumes the library as a local
package dependency:

```json
"aify": "file:../aify"
```

The bridge is the Rust binary built from `../mcp`.

## What's here

- `src/App.vue` + `src/components/*` — a page graph:
  `login → home → logout-confirm-dialog → login`.
- `host/agent.ts` — a demo "agent" that runs the exact algorithm:
  `map → routine → snapshot → act → wait_for_ui → waitForFocus → ...`

The page does **not** auto-connect. The user pastes the bridge credential into
the `ConnectPanel` and clicks connect; only then does the WebSocket open.

## Run it

```bash
# 1) install local dependencies (run from demo/)
npm install

# 2) terminal A — start the page
npm run dev            # Vite on http://localhost:5173

# 3) terminal B — start the Rust MCP bridge
npm run host           # MCP server mode: http :7798 (/sse,/streamable,/http) + ws :7799

# 4) terminal C — drive the page with the demo agent
npm run agent
```

You should see: map pages → snapshot focused `login` → fill `username` → click
login (transitions to `home`) → open the logout dialog
(`logout-confirm-dialog`) → confirm (back to `login`). Open
<http://localhost:5173> to watch it live.

## Talk to it yourself

```bash
curl -s -X POST http://127.0.0.1:7798 -H 'content-type: application/json' \
  -d '{"method":"map"}'

curl -s -X POST http://127.0.0.1:7798 -H 'content-type: application/json' \
  -d '{"method":"snapshot"}'
```

Tools: `map`, `routine`, `snapshot`, `act` (`{actionId, value?}`),
`wait_for_ui` (`{timeoutMs?}`).

## Notes

- The static page graph is declared in `src/main.ts` and passed via
  `installAify({ graph })`. `map`/`routine` stay complete even while a page is
  unmounted (`v-if`).
- Dynamic nodes/edges are appended when the app observes them: a page registers
  on mount, and an actual `act` with `transitionsTo` records the traversed edge.
- `act` only invokes a pre-registered fixed handler — it never runs arbitrary JS
  and never manages focus/routing. The page owns those.
- `wait_for_ui` polls only the focused page's `ready` flag.
- A focus transition is a separate fact; after an `act` with `transitionsTo`,
  the agent re-reads `map()` until the target page reports `focused: true`.
- `STEP_PAUSE_MS` at the top of `host/agent.ts` controls the pause between
  operations.

## Checks

```bash
npx tsc --noEmit -p tsconfig.json
npx vite build
```
