<script setup lang="ts">
import { inject, ref, onMounted, onUnmounted } from 'vue'
import type { ConnectController, ConnectionStatus } from 'vue-aify'

// The transport is provided by main.ts. The page never auto-connects: the user
// pastes the bridge's connection credential (a base64 string) and clicks connect.
const transport = inject<ConnectController>('aifyTransport')

const credential = ref('')
const status = ref<ConnectionStatus>('idle')
const detail = ref<{ error?: string }>({})
let unsub: (() => void) | null = null

onMounted(() => {
  if (!transport) return
  status.value = transport.status()
  unsub = transport.onStatus((s, d) => {
    status.value = s
    detail.value = d ?? {}
  })
})
onUnmounted(() => unsub?.())

function connect() {
  if (!transport) return
  transport.connect(credential.value)
}
function disconnect() {
  transport?.disconnect()
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
        :disabled="status === 'connected' || status === 'connecting'"
      />
    </label>
    <div class="row">
      <button
        v-if="status !== 'connected'"
        class="primary"
        :disabled="!credential.trim() || status === 'connecting'"
        @click="connect"
      >
        {{ status === 'connecting' ? 'connecting...' : 'connect' }}
      </button>
      <button v-else @click="disconnect">disconnect</button>
      <span class="status" :class="status">{{ status }}</span>
    </div>
    <p v-if="status === 'error'" class="error">connection failed{{ detail.error }}</p>
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
.status.error { color: #dc2626; }
.error { color: #dc2626; font-size: 0.85rem; margin: 6px 0 0; }
</style>
