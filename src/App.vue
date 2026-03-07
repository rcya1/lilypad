<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
</script>

<template>
  <div v-if="auth.loading" class="flex items-center justify-center h-screen bg-bg">
    <div class="text-text-muted text-sm font-ui">Loading...</div>
  </div>
  <router-view v-else />
</template>
