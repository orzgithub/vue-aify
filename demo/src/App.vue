<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ConnectPanel from './components/ConnectPanel.vue'

// URL is the source of truth for the page graph. The route name matches the
// page id declared in the static graph (src/main.ts), so `map()` and
// `snapshot()` follow the URL — browser back/forward and direct links included.
const route = useRoute()
const router = useRouter()

// The modal is transient overlay state, not a URL route.
const dialogOpen = ref(false)

type PageName = 'login' | 'login-error' | 'home'
const pageName = computed<PageName>(() => {
  const name = route.name
  return name === 'login-error' || name === 'home' ? name : 'login'
})

// The page directive is evaluated when the keyed wrapper mounts, so this
// function returns the metadata for the current URL route.
function pageMeta() {
  if (pageName.value === 'login') {
    return {
      id: 'login',
      title: 'login page',
      loading: false,
      focused: () => pageName.value === 'login' && !dialogOpen.value,
    }
  }
  if (pageName.value === 'login-error') {
    return {
      id: 'login-error',
      title: 'login failed',
      loading: false,
      focused: () => pageName.value === 'login-error' && !dialogOpen.value,
    }
  }
  return {
    id: 'home',
    title: 'home page',
    loading: false,
    focused: () => pageName.value === 'home' && !dialogOpen.value,
  }
}

function goHome() {
  router.push({ name: 'home' })
}
function loginFailed() {
  router.push({ name: 'login-error' })
}
function backToLogin() {
  router.push({ name: 'login' })
}
function openDialog() {
  dialogOpen.value = true
}
function closeDialog() {
  dialogOpen.value = false
}
function logout() {
  dialogOpen.value = false
  router.push({ name: 'login' })
}
</script>

<template>
  <div class="app">
    <h1>AIfy DEMO — AI-native control layer</h1>

    <!-- The user must supply the bridge's connection credential and click
         connect. The page never auto-connects and never pre-knows any URL. -->
    <ConnectPanel />

    <!--
      Pages may be mounted/unmounted dynamically. The static graph in main.ts
      keeps their nodes/edges visible to map/routine even while unmounted.
      `:key="pageName"` forces a fresh page registration when the URL changes.
      The route line is marked as text, so snapshot() shows the agent the URL.
    -->
    <RouterView v-slot="{ Component }">
      <div :key="pageName" v-aify:page="pageMeta()">
        <p class="route-info" v-aify:text="{ description: 'current URL route' }">
          URL route: <code>{{ route.name }}</code> — <code>{{ route.fullPath }}</code>
        </p>
        <component
          :is="Component"
          @success="goHome"
          @failure="loginFailed"
          @back="backToLogin"
          @open-dialog="openDialog"
          @logout="logout"
        />
      </div>
    </RouterView>

    <!-- Modal = a separate page node. While open it is the focused page. -->
    <ConfirmDialog
      v-if="dialogOpen"
      v-aify:page="{ id: 'logout-confirm-dialog', title: 'logout confirm', loading: false, focused: () => dialogOpen }"
      @confirm="logout"
      @cancel="closeDialog"
    />
  </div>
</template>

<style>
.app { font-family: system-ui, sans-serif; max-width: 520px; margin: 2rem auto; padding: 1rem; }
.route-info { color: #64748b; font-size: 0.85rem; margin: 0 0 0.75rem; }
.route-info code { color: #334155; }
.page { border: 1px solid #ddd; border-radius: 10px; padding: 1.25rem; margin-top: 1rem; }
.page h2 { margin-top: 0; }
.hint { color: #64748b; font-size: 0.85rem; margin: -0.25rem 0 0.75rem; }
button { padding: 6px 12px; margin-right: 8px; cursor: pointer; border-radius: 6px; border: 1px solid #bbb; }
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
.field { margin-bottom: 0.75rem; }
.module { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 0.75rem; margin-top: 0.75rem; }
.module h3 { margin: 0 0 0.5rem; font-size: 0.95rem; color: #475569; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; }
.dialog { background: #fff; border-radius: 10px; padding: 1.5rem; width: 320px; }
</style>
