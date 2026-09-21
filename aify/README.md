# AIfy — AI-native control layer for Vue

Make a GUI "AI-native": instead of scraping screenshots or accessibility trees,
the AI fetches the GUI's **operable elements + text as data**, and operates it by
**element id** through a small set of fixed operations.

This package is the reusable library only. The MCP bridge lives in `../mcp`; the
runnable demo lives in `../demo`.

## Core model — a "window manager"

- The UI is a **directive graph**: nodes are `page`s, edges are `action`s.
- An action declares `transitionsTo: <pageId>` → that is the edge.
- **Exactly one page is `focused`** at a time.
- `act` only invokes a pre-registered, fixed handler. It never runs arbitrary JS
  and never manages focus/routing.

## The 5 tools

| Tool | Input | Output |
|---|---|---|
| `map` | — | all existing pages `{id,title,description,focused,ready}` |
| `routine` | `{node?}` | edges `[{from,to,via,label,sideEffects}]` |
| `snapshot` | — | focused page tree of actions/modules |
| `act` | `{actionId, value?}` | `{ok, transitionsTo?}`; errors: `unknown \| not focused \| disabled \| missing value` |
| `wait_for_ui` | `{timeoutMs?}` | `{ready:true}` or `{ready:false,reason:'timeout'}` |

`map` and `routine` are the graph-planning tools. Static pages/edges can be
declared at build time via `installAify({ graph })`; those nodes stay in the
graph even when their component is unmounted (`v-if`). Dynamic pages are
appended when they are observed/mounted, and dynamic edges are appended when an
`act` actually traverses a `transitionsTo` action.

`wait_for_ui` polls only the focused page's `ready` flag — never individual
elements.

## Vue usage

```vue
<script setup>
const isFocused = () => true
</script>

<template>
  <div v-aify:page="{ id: 'login', title: 'login page', focused: isFocused }">
    <section v-aify:module="{ name: 'credentials', description: 'credentials for login' }">
      <input v-aify:input="{ description: 'input username', required: true }" placeholder="username" />
      <button v-aify:click="{
        description: 'start login',
        sideEffects: 'send a login request',
        transitionsTo: 'home'
      }">login</button>
    </section>
  </div>
</template>
```

Install once:

```ts
import { createApp } from 'vue'
import { installAify, createWebSocketTransport } from 'aify'

const graph = {
  pages: [
    { id: 'login', title: 'login page' },
    { id: 'home', title: 'home page' },
  ],
  edges: [
    { from: 'login', to: 'home' },
  ],
}

const app = createApp(App)
installAify(app, {
  directiveName: 'aify',
  graph,
  transport: createWebSocketTransport({ kind: 'web' }),
})
app.mount('#app')
```

The page does **not** auto-connect. The user pastes the bridge credential
(base64 ticket) into the UI; only then does the transport open a WebSocket to
the URL inside the ticket.

## Agent algorithm

```
goal → map()            recognize the target page
     → routine()        find a path (edges)
     → snapshot()       find the handle
     → act()            invoke the fixed handler
     → wait_for_ui()    until the focused page is ready
     → re-read map()/snapshot() on arrival
```

The agent never keeps its own page state.

## Project layout

```
src/
  core/                framework-agnostic (no Vue, no DOM)
    types.ts           OperationPlane contract + serialized shapes + results
    registry.ts        node store + tree/edge builder
    operationPlane.ts  the 5-tool implementation
    a11y.ts            reuses aria/placeholder/text
    setNativeValue.ts  prototype setter so v-model detects programmatic input
  vue/                 the only Vue/DOM-aware layer
    directives.ts      v-aify:page|module|click|input + install()
  transport/           WebSocket client contract + implementation
    types.ts
    websocket.ts
  bridge/
    ticket.ts          browser-safe ticket codec (no node:crypto)
  index.ts             public API
test/
  core.smoke.ts        framework-agnostic smoke test
```

## Commands

```bash
npm install
npm run typecheck
npm run build
npm test
```

`npm run build` emits `dist/` with rewritten `.js` imports (TypeScript 5.7+
`rewriteRelativeImportExtensions`). The package `main`/`exports` intentionally
point at `src/` so a monorepo consumer can use the TypeScript source directly
during development.
