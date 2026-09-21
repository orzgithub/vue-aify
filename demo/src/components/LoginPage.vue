<script setup lang="ts">
import { ref } from 'vue'

const username = ref('')
const password = ref('')
const emit = defineEmits<{ success: [] }>()

function submit() {
  // Pretend to authenticate; real apps would call an API then emit.
  emit('success')
}
</script>

<template>
  <div class="page">
    <h2>Login</h2>
    <div class="module" v-aify:module="{ name: 'credentials', description: 'login credentials' }">
      <div class="field">
        <input
          v-model="username"
          v-aify:input="{ description: 'input the username', required: true }"
          placeholder="username"
          aria-label="username"
        />
      </div>
      <div class="field">
        <input
          v-model="password"
          type="password"
          v-aify:input="{ description: 'input the password', required: true }"
          placeholder="password"
          aria-label="password"
        />
      </div>
      <button
        class="primary"
        v-aify:click="{ description: 'submit the login info', sideEffects: 'start login and go to home page when success', transitionsTo: 'home' }"
        @click="submit"
      >login</button>
    </div>
  </div>
</template>
