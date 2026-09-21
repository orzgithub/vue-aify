<script setup lang="ts">
import { ref } from 'vue'

const note = ref('')
const emit = defineEmits<{ 'open-dialog': []; logout: [] }>()

function decrement() {
  note.value = 'Refreshed'
}
</script>

<template>
  <div class="page">
    <h2>Home page</h2>
    <p class="module" v-aify:module="{ name: 'welcome', description: 'welcome area' }">
      Welcome.
    </p>

    <div class="module" v-aify:module="{ name: 'actions', description: 'functions area' }">
      <h3>functions</h3>
      <div class="field">
        <input
          v-model="note"
          v-aify:input="{ description: 'input the note' }"
          placeholder="note"
          aria-label="note"
        />
      </div>
      <button
        class="primary"
        v-aify:click="{ description: 'refresh', sideEffects: 'refresh the info on the home page' }"
        @click="decrement"
      >refresh</button>
      <button
        v-aify:click="{ description: 'logout', sideEffects: 'open the logout dialog', transitionsTo: 'logout-confirm-dialog' }"
        @click="emit('open-dialog')"
      >logout</button>
    </div>
  </div>
</template>
