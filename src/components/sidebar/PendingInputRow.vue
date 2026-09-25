<!-- Inline name input in the tree for a new file or folder. -->
<script setup lang="ts">
import { FileText, Folder, Check } from 'lucide-vue-next'

defineProps<{
  modelValue: string
  type: 'file' | 'folder'
  depth: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
  cancel: []
  dragstart: [e: DragEvent]
  dragend: []
}>()
</script>

<template>
  <div
    data-pending-input
    class="flex items-center gap-1.5 py-1 px-2 rounded-sm bg-surface-elevated"
    :style="{ paddingLeft: depth * 24 + 12 + 'px' }"
    draggable="true"
    @dragstart="emit('dragstart', $event)"
    @dragend="emit('dragend')"
  >
    <span class="flex items-center shrink-0">
      <FileText v-if="type === 'file'" :size="17" class="text-text-secondary" />
      <Folder v-else :size="17" class="text-amber" />
    </span>
    <input
      :value="modelValue"
      class="flex-1 min-w-0 bg-transparent outline-none text-sm text-text-primary font-ui"
      :placeholder="type === 'file' ? 'filename.md' : 'folder name'"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('submit')"
      @keydown.escape="emit('cancel')"
      v-focus
    />
    <!-- mousedown.prevent keeps the input focused, so clicking commits rather than blur-cancels -->
    <button
      class="flex items-center justify-center w-4 h-4 rounded text-accent hover:bg-surface-overlay transition-colors cursor-pointer shrink-0"
      @mousedown.prevent
      @click="emit('submit')"
    >
      <Check :size="13" />
    </button>
  </div>
</template>
