<script setup lang="ts">
import { inject, ref, computed, onMounted, onUnmounted } from 'vue'
import type { ConnectController, ConnectionStatus, StatusDetail } from 'vue-aify'

// The transport is provided by main.ts. The page never auto-connects: the user
// pastes the bridge's connection credential (a base64 string) and clicks connect.
const transport = inject<ConnectController>('aifyTransport')

// sessionStorage holds the credential ONLY while a tab session is alive, so a
// reload / full-page navigation within the same tab can re-establish the bridge
// connection automatically. Closing the tab clears it (we don't want a brand-new
// tab to silently reconnect, and the user must still decide to connect).
const STORAGE_KEY = 'aify:bridge-credential'

const credential = ref('')
const status = ref<ConnectionStatus>('idle')
const detail = ref<StatusDetail>({})
let unsub: (() => void) | null = null

// The terminal `disconnected` state carries a `reason` that tells the user what
// to do next. The credential is unusable for the fatal reasons, so the user must
// repaste a fresh one; for `gave-up`/`closed`/`manual` the saved credential is
// still valid and a retry button is offered.
const reason = computed(() => detail.value.reason)
const fatal = computed(
  () => reason.value === 'invalid-ticket' || reason.value === 'handshake-failed' || reason.value === 'expired',
)
const canRetry = computed(() => status.value === 'disconnected' && !fatal.value)

onMounted(() => {
  if (!transport) return
  status.value = transport.status()
  unsub = transport.onStatus((s, d) => {
    status.value = s
    detail.value = d ?? {}
    // Persist the credential while a live (or reconnecting) session owns it;
    // drop it the moment it becomes unusable or the user disconnects.
    if (s === 'connected' || s === 'reconnecting') {
      sessionStorage.setItem(STORAGE_KEY, credential.value.trim())
    } else if (s === 'idle' || s === 'disconnected') {
      sessionStorage.removeItem(STORAGE_KEY)
    }
  })
  // Full-page navigation recovery: if we had a live session before the reload,
  // restore it automatically (same tab only).
  const saved = sessionStorage.getItem(STORAGE_KEY)
  if (saved && status.value === 'idle') {
    credential.value = saved
    transport.connect(saved)
  }
})
onUnmounted(() => unsub?.())

function connect() {
  if (!transport) return
  transport.connect(credential.value)
}
function disconnect() {
  transport?.disconnect()
  sessionStorage.removeItem(STORAGE_KEY)
}
function retry() {
  if (!transport) return
  // Reuse either the field or the last-saved credential (retry after a drop).
  const cred = credential.value.trim() || sessionStorage.getItem(STORAGE_KEY) || ''
  if (!cred) return
  credential.value = cred
  transport.connect(cred)
}
</script>

<template>
  <div class="connect">
    <label class="field">
      <span>bridge connection credential</span>
      <input
        v-model="credential"
        type="text"
        placeholder="plaste the credential from bridge console and connect"
        :disabled="status === 'connected' || status === 'connecting' || status === 'reconnecting'"
      />
    </label>
    <div class="row">
      <button
        v-if="status !== 'connected' && !canRetry"
        class="primary"
        :disabled="!credential.trim() || status === 'connecting' || status === 'reconnecting'"
        @click="connect"
      >
        {{ status === 'connecting' || status === 'reconnecting' ? 'connecting...' : 'connect' }}
      </button>
      <button v-else-if="canRetry" class="primary" @click="retry">retry</button>
      <button v-if="status === 'connected'" @click="disconnect">disconnect</button>
      <span class="status" :class="status">{{ status }}</span>
    </div>
    <p v-if="status === 'reconnecting'" class="hint">bridge connection dropped — retrying automatically…</p>
    <p v-else-if="status === 'disconnected' && fatal" class="error">
      connection failed: {{ detail.error || reason }} — paste a fresh credential and connect again.
    </p>
    <p v-else-if="status === 'disconnected' && !fatal" class="hint">
      {{ detail.error || 'disconnected' }} — click retry to reconnect.
    </p>
    <p v-else-if="status === 'error'" class="error">connection failed{{ detail.error }}</p>
  </div>
</template>

<style scoped>
.connect { border: 1px solid #e2e8f0; border-radius: 10px; padding: 1rem; margin-bottom: 1rem; background: #f8fafc; }
.field { display: block; }
.field span { display: block; font-size: 0.85rem; color: #475569; margin-bottom: 4px; }
.field input { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; width: 100%; box-sizing: border-box; }
.row { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
button { padding: 6px 12px; cursor: pointer; border-radius: 6px; border: 1px solid #bbb; }
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.status { font-size: 0.8rem; color: #64748b; text-transform: uppercase; }
.status.connected { color: #16a34a; }
.status.reconnecting { color: #d97706; }
.status.disconnected { color: #dc2626; }
.status.error { color: #dc2626; }
.hint { color: #d97706; font-size: 0.85rem; margin: 6px 0 0; }
.error { color: #dc2626; font-size: 0.85rem; margin: 6px 0 0; }
</style>
