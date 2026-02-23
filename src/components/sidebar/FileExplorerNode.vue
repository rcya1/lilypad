<script setup lang="ts">
import { ref } from 'vue'
import type { Entry } from '@/types/file-explorer'
import { isDirectory } from '@/types/file-explorer'

const props = defineProps<{
  entry: Entry
  depth: number
}>()

const isOpen = ref(true)

const toggle = () => {
  if (isDirectory(props.entry)) {
    isOpen.value = !isOpen.value
  }
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-gray-200"
      :style="{ paddingLeft: depth * 14 + 8 + 'px' }"
      @click="toggle"
    >
      <!-- Chevron -->
      <span class="w-4 text-gray-500">
        <template v-if="isDirectory(entry)">
          {{ isOpen ? '▾' : '▸' }}
        </template>
      </span>

      <!-- Icon -->
      <span class="w-4">
        <template v-if="isDirectory(entry)">📁</template>
        <template v-else>📄</template>
      </span>

      <!-- Name -->
      <span class="truncate">
        {{ entry.name }}
      </span>
    </div>

    <div v-if="isDirectory(entry) && isOpen">
      <FileExplorerNode
        v-for="child in entry.children"
        :key="child.name"
        :entry="child"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>
