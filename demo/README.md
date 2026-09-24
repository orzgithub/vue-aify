# AIfy DEMO — AI-native control layer (Vue)

A runnable demo of the `vue-aify` Vue plugin and the Rust MCP bridge. The agent
never scrapes the DOM or screenshots: it pulls the GUI's operable elements +
text as **data** via the fixed tools
(`map` / `routine` / `snapshot` / `act` / `wait_for_ui`) and drives the page by
element ID through exactly two action types (`click` / `input`).

This folder is an independent subproject. It consumes the library as a local
package dependency:

```json
"vue-aify": "file:../aify"
```

The bridge is the Rust binary built from `../mcp`.

## What's here

- `src/App.vue` + `src/router.ts` + `src/components/*` — a page graph:
  `login → home → logout-confirm-dialog → login`, plus the failure edge
  `login → login-error → login`.
- `src/router.ts` — hash-based URL routes whose names match the static page ids
  (`#/login`, `#/login-error`, `#/home`); the URL is the source of truth for
  which page is focused.
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

You should see: map pages → routine (both login branches) → snapshot focused
`login` → fill wrong credentials → submit → failure branch to `login-error` →
back → fill `admin` / `demoP@ssw0rd` → success branch to `home` → open the
logout dialog (`logout-confirm-dialog`) → confirm (back to `login`). Open
<http://localhost:5173> to watch it live.

Demo credentials: **admin / demoP@ssw0rd**. Any other pair takes the failure
branch and lands on `login-error`.

## URL routing

The demo uses `vue-router` with **hash history**, so every page has a real URL
and the browser back/forward buttons work:

- <http://localhost:5173/#/login> — login page
- <http://localhost:5173/#/login-error> — failure page
- <http://localhost:5173/#/home> — home page

Opening any of these directly renders that page and `map()` reports it as the
focused page. The route name equals the static page id in `src/main.ts`, so the
agent's `act`-driven transitions and manual URL navigation both flow through the
same page graph. When `act` triggers a branch, the page calls `router.push`, so
the address bar and history update along with the focused page.

The route line inside each page is marked with `v-aify:text`, so `snapshot()`
shows the agent the current URL as a text node, e.g.
`{"kind":"text","text":"URL route: home — /home","description":"current URL route"}`.

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
  unmounted (the routed `<RouterView>` shows one page at a time).
- Dynamic nodes/edges are appended when the app observes them: a page registers
  on mount, and an actual `act` with `transitionsTo` records the traversed edge.
- Actions may declare `success` / `failure` branches with their own
  `description`, `when`, `sideEffects` and `transitionsTo`; flat legacy fields
  remain the success branch. `routine` reports the branch as
  `outcome: 'success' | 'failure'`.
- The login button declares both branches in `src/components/LoginPage.vue`:
  `success` → `home` when the username is `admin` and the password is
  `demoP@ssw0rd`, `failure` → `login-error` otherwise. `routine` therefore
  exposes both edges before the login page is mounted.
- `v-aify:text` marks read-only text as agent-visible; it shows up in
  `snapshot()` as `{ kind: 'text', text, description }`.
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
