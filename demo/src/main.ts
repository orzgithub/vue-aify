import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'

// The demo consumes the library as a normal package dependency (`file:../aify`).
import { installAify, createWebSocketTransport, type AifyGraph } from 'vue-aify'

// Static graph: determined at build time, independent of which page is mounted.
// Dynamic pages/edges are appended later by registration/traversal.
const graph: AifyGraph = {
  pages: [
    { id: 'login', title: 'login page' },
    { id: 'login-error', title: 'login failed' },
    { id: 'home', title: 'home page' },
    { id: 'logout-confirm-dialog', title: 'logout confirm' },
  ],
  edges: [
    // The login action has two declared branches. Static edges describe both
    // targets before the page is mounted; live actions bind them by `outcome`.
    {
      from: 'login',
      to: 'home',
      when: 'username is admin and password is demoP@ssw0rd',
    },
    {
      from: 'login',
      to: 'login-error',
      outcome: 'failure',
      when: 'username or password is incorrect',
    },
    { from: 'login-error', to: 'login' },
    { from: 'home', to: 'logout-confirm-dialog' },
    { from: 'logout-confirm-dialog', to: 'login' },
    { from: 'logout-confirm-dialog', to: 'home' },
  ],
}

const app = createApp(App)

// URL is the source of truth for the page graph. The route names match the
// static page ids above, so map()/snapshot() follow the URL and browser
// back/forward works.
app.use(router)

// NOTE: the page does NOT auto-connect and does NOT pre-know any URL. The user
// supplies the bridge's connection credential (a base64 string) through the UI
// and clicks connect — only then does a socket open. See App.vue.
const { transport } = installAify(app, {
  directiveName: 'aify', // -> v-aify:page|module|click|input|text
  graph,
  transport: createWebSocketTransport({ kind: 'web' }),
})

app.provide('aifyTransport', transport)
app.mount('#app')
