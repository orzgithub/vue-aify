import { createApp } from 'vue'
import App from './App.vue'

// The demo consumes the library as a normal package dependency (`file:../aify`).
import { installAify, createWebSocketTransport, type AifyGraph } from 'vue-aify'

// Static graph: determined at build time, independent of which page is mounted.
// Dynamic pages/edges are appended later by registration/traversal.
const graph: AifyGraph = {
  pages: [
    { id: 'login', title: 'login page' },
    { id: 'home', title: 'home page' },
    { id: 'logout-confirm-dialog', title: 'logout confirm' },
  ],
  edges: [
    { from: 'login', to: 'home' },
    { from: 'home', to: 'logout-confirm-dialog' },
    { from: 'logout-confirm-dialog', to: 'login' },
    { from: 'logout-confirm-dialog', to: 'home' },
  ],
}

const app = createApp(App)

// NOTE: the page does NOT auto-connect and does NOT pre-know any URL. The user
// supplies the bridge's connection credential (a base64 string) through the UI
// and clicks connect — only then does a socket open. See App.vue.
const { transport } = installAify(app, {
  directiveName: 'aify', // -> v-aify:page|module|click|input
  graph,
  transport: createWebSocketTransport({ kind: 'web' }),
})

app.provide('aifyTransport', transport)
app.mount('#app')
