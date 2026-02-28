<script setup lang="ts">
import LilypadSidebar from './components/sidebar/LilypadSidebar.vue'
import LilypadIcon from '@/assets/icon-light.svg'
</script>

<template>
  <div class="flex flex-row h-screen bg-bg overflow-hidden">
    <LilypadSidebar />
    <main class="flex-1 flex items-center justify-center bg-bg overflow-auto">
      <div class="flex flex-col items-center gap-3 text-center">
        <LilypadIcon class="w-16 h-16 opacity-[0.08]" />
        <h2 class="font-display italic text-2xl font-normal text-text-secondary">
          Open a note to begin
        </h2>
        <p class="text-sm text-text-muted">Select a file from the sidebar</p>
      </div>
    </main>
  </div>
</template>
