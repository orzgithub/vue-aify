<script setup lang="ts">
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <div class="overlay">
    <div class="dialog">
      <h2>Confirm logout?</h2>
      <p class="module" v-aify:module="{ name: 'confirm-body', description: 'confirm to logout' }">
        Will return to the login page.
      </p>
      <button
        class="primary"
        v-aify:click="{ description: 'confirm', sideEffects: 'return to the login page', transitionsTo: 'login' }"
        @click="emit('confirm')"
      >confirm</button>
      <button
        v-aify:click="{ description: 'cancel', sideEffects: 'close the confirm dialog and return to the home page', transitionsTo: 'home' }"
        @click="emit('cancel')"
      >cancel</button>
    </div>
  </div>
</template>
