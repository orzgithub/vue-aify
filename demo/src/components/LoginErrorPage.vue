<script setup lang="ts">
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <div class="page">
    <h2>Login failed</h2>
    <div class="module" v-aify:module="{ name: 'login-error-body', description: 'login error detail' }">
      <p v-aify:text="{ description: 'login error message' }">The username or password is incorrect.</p>
    </div>
    <button
      class="primary"
      v-aify:click="{
        description: 'return to login',
        sideEffects: 'go back to the login page',
        transitionsTo: 'login',
      }"
      @click="emit('back')"
    >back to login</button>
  </div>
</template>
