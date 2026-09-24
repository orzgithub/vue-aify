import { createRouter, createWebHashHistory } from 'vue-router'
import LoginPage from './components/LoginPage.vue'
import LoginErrorPage from './components/LoginErrorPage.vue'
import HomePage from './components/HomePage.vue'

// Hash history keeps the demo self-contained on any static host, while still
// giving the page real URL/history behavior: the browser back/forward buttons
// and opening #/home directly both work. The route name matches the page id in
// the static graph (src/main.ts), so `map()` / `snapshot()` focus follows the
// URL without the agent knowing anything about routing.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: { name: 'login' } },
    { path: '/login', name: 'login', component: LoginPage },
    { path: '/login-error', name: 'login-error', component: LoginErrorPage },
    { path: '/home', name: 'home', component: HomePage },
    { path: '/:pathMatch(.*)*', redirect: { name: 'login' } },
  ],
})
