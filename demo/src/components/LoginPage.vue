<script setup lang="ts">
import { ref } from 'vue'

const ADMIN_USER = 'admin'
const ADMIN_PASSWORD = 'demoP@ssw0rd'

const username = ref('')
const password = ref('')

const emit = defineEmits<{ success: []; failure: [] }>()

function credentialsValid() {
  return username.value === ADMIN_USER && password.value === ADMIN_PASSWORD
}

function submit() {
  // Real apps would call an API here. The demo decides locally so the agent
  // can observe two distinct branches.
  if (credentialsValid()) emit('success')
  else emit('failure')
}
</script>

<template>
  <div class="page">
    <h2>Login</h2>
    <p class="hint">Demo credentials: admin / demoP@ssw0rd</p>
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
        v-aify:click="{
          description: 'submit the login info',
          success: {
            description: 'login succeeded',
            when: 'username is admin and password is demoP@ssw0rd',
            sideEffects: 'enter the home page',
            transitionsTo: 'home',
          },
          failure: {
            description: 'login failed',
            when: 'username or password is incorrect',
            sideEffects: 'show the login error page',
            transitionsTo: 'login-error',
          },
          resolveOutcome: () =>
            credentialsValid()
              ? { outcome: 'success' }
              : { outcome: 'failure', error: 'invalid credentials' },
        }"
        @click="submit"
      >login</button>
    </div>
  </div>
</template>
