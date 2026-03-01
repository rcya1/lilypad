<script setup lang="ts">
import { computed, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'

const store = useEditorStore()
const tabs = computed(() => store.tabOrder.map((id) => store.openDocuments.get(id)!))

const draggedId = ref<string | null>(null)
const dropIndex = ref<number | null>(null)

function onDragStart(e: DragEvent, id: string) {
  draggedId.value = id
  e.dataTransfer!.effectAllowed = 'move'
  // Needed for Firefox
  e.dataTransfer!.setData('text/plain', id)
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'move'
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dropIndex.value = e.clientX < rect.left + rect.width / 2 ? index : index + 1
}

function onDragOverEnd(e: DragEvent) {
  e.preventDefault()
  dropIndex.value = tabs.value.length
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  if (draggedId.value !== null && dropIndex.value !== null) {
    store.moveTab(draggedId.value, dropIndex.value)
  }
  draggedId.value = null
  dropIndex.value = null
}

function onDragEnd() {
  draggedId.value = null
  dropIndex.value = null
}
</script>

<template>
  <div
    class="flex items-stretch bg-surface border-b border-border-subtle shrink-0 overflow-x-auto"
    style="height: 40px"
    @dragover.prevent
    @drop="onDrop"
  >
    <template v-for="(tab, i) in tabs" :key="tab.id">
      <!-- Drop indicator line -->
      <div
        v-if="draggedId && dropIndex === i"
        class="w-0.5 bg-accent shrink-0 self-stretch"
      />

      <button
        class="group relative flex items-center gap-1.5 px-3 text-sm border-r border-border-subtle shrink-0 transition-colors duration-100 cursor-pointer select-none"
        :class="[
          tab.id === store.activeDocumentId
            ? 'bg-bg text-text-primary'
            : 'bg-surface text-text-secondary hover:bg-surface-elevated hover:text-text-primary',
          draggedId === tab.id ? 'opacity-40' : '',
        ]"
        draggable="true"
        @click="store.setActiveDocument(tab.id)"
        @dragstart="onDragStart($event, tab.id)"
        @dragover="onDragOver($event, i)"
        @dragend="onDragEnd"
      >
        <!-- Active indicator bar -->
        <span
          v-if="tab.id === store.activeDocumentId"
          class="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
        />

        <span class="truncate max-w-35 font-ui text-sm">{{ tab.name }}</span>

        <!-- Close button -->
        <span
          class="flex items-center justify-center w-5 h-5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-overlay transition-colors duration-100"
          :class="
            tab.id === store.activeDocumentId
              ? 'opacity-80 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-70 hover:opacity-100!'
          "
          @click.stop="store.closeDocument(tab.id)"
        >
          <X :size="13" />
        </span>
      </button>
    </template>

    <!-- Drop indicator at the end -->
    <div
      v-if="draggedId && dropIndex === tabs.length"
      class="w-0.5 bg-accent shrink-0 self-stretch"
    />

    <!-- Trailing drag target area (rest of the tab bar) -->
    <div class="flex-1" @dragover="onDragOverEnd" @drop="onDrop" />
  </div>
</template>
