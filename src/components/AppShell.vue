<!-- Top-level layout: sidebar and editor pane side by side, filling the full viewport. -->
<script setup lang="ts">
import LilypadSidebar from './sidebar/LilypadSidebar.vue'
import EditorPane from './editor/EditorPane.vue'
import { useOpenEntryFromQuery } from '@/composables/useOpenEntryFromQuery'

// `/?open=<entryId>` (e.g. the reader's Edit button) opens that entry in the editor.
useOpenEntryFromQuery()
</script>

<template>
  <div class="flex flex-row h-screen bg-bg overflow-hidden">
    <LilypadSidebar />
    <EditorPane />
  </div>
</template>
