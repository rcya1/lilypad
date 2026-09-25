<script setup lang="ts">
import LilypadSidebar from './sidebar/LilypadSidebar.vue'
import EditorPane from './editor/EditorPane.vue'
import { useOpenEntryFromQuery } from '@/composables/useOpenEntryFromQuery'

useOpenEntryFromQuery()
</script>

<template>
  <div class="flex flex-row h-screen bg-bg overflow-hidden">
    <LilypadSidebar />
    <EditorPane />
  </div>
</template>
