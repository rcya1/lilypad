<script setup lang="ts">
import { computed } from 'vue'
import { useEditorStore } from '@/stores/editor'
import TextEditor from './TextEditor.vue'
import EditorTabs from './EditorTabs.vue'
import LilypadIcon from '@/assets/icon-light.svg'

const store = useEditorStore()
const hasTabs = computed(() => store.tabOrder.length > 0)
const activeId = computed(() => store.activeDocumentId)
</script>

<template>
  <main class="flex-1 flex flex-col overflow-hidden bg-bg">
    <template v-if="hasTabs">
      <EditorTabs />
      <TextEditor
        v-for="id in store.tabOrder"
        v-show="id === activeId"
        :key="id"
        :document-id="id"
        :is-active="id === activeId"
        class="flex-1"
      />
    </template>
    <template v-else>
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-center">
          <LilypadIcon class="w-16 h-16 opacity-[0.08]" />
          <h2 class="font-display text-2xl font-normal text-text-secondary">
            Open a note to begin
          </h2>
          <p class="text-sm text-text-muted">Select a file from the sidebar</p>
        </div>
      </div>
    </template>
  </main>
</template>
