<script setup lang="ts">
import { ref } from 'vue'
import LoginPage from './components/LoginPage.vue'
import HomePage from './components/HomePage.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ConnectPanel from './components/ConnectPanel.vue'

// The "window manager" state: exactly one focused page at a time.
const route = ref<'login' | 'home'>('login')
const dialogOpen = ref(false)

function goHome() {
  route.value = 'home'
}
function openDialog() {
  dialogOpen.value = true
}
function closeDialog() {
  dialogOpen.value = false
}
function logout() {
  dialogOpen.value = false
  route.value = 'login'
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
    -->
    <LoginPage
      v-if="route === 'login'"
      v-aify:page="{ id: 'login', title: 'login page', loading: false, focused: () => route === 'login' && !dialogOpen }"
      @success="goHome"
    />

    <HomePage
      v-if="route === 'home'"
      v-aify:page="{ id: 'home', title: 'home page', loading: false, focused: () => route === 'home' && !dialogOpen }"
      @open-dialog="openDialog"
      @logout="logout"
    />

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
.page { border: 1px solid #ddd; border-radius: 10px; padding: 1.25rem; margin-top: 1rem; }
.page h2 { margin-top: 0; }
button { padding: 6px 12px; margin-right: 8px; cursor: pointer; border-radius: 6px; border: 1px solid #bbb; }
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
.field { margin-bottom: 0.75rem; }
.module { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 0.75rem; margin-top: 0.75rem; }
.module h3 { margin: 0 0 0.5rem; font-size: 0.95rem; color: #475569; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; }
.dialog { background: #fff; border-radius: 10px; padding: 1.5rem; width: 320px; }
</style>
