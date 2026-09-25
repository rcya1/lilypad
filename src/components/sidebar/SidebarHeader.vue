<!-- Top of both sidebars: logo, wordmark, Read/Edit switch, search. Shared so both modes render it
     identically. The slot goes after search (the editor's saving spinner). -->
<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import LilypadIcon from '@/assets/icon.svg'
import ModeSwitch, { type AppMode } from '@/components/ModeSwitch.vue'

defineProps<{
  mode: AppMode
  /** Logo only. */
  minimized: boolean
  /** In px; the wordmark drops out when there isn't room. */
  width: number
}>()
const emit = defineEmits<{ switch: []; search: [] }>()

const WORDMARK_MIN_WIDTH = 236
</script>

<template>
  <div class="flex flex-row items-center p-4 wco:app-drag wco:titlebar-inset-l">
    <LilypadIcon class="w-8 h-8 shrink-0" :class="{ 'mr-2': !minimized }" />
    <template v-if="!minimized">
      <h1
        v-if="width >= WORDMARK_MIN_WIDTH"
        class="mr-2.5 font-display font-medium text-xl text-text-primary leading-none"
      >
        Lilypad
      </h1>
      <ModeSwitch :mode="mode" @change="emit('switch')" />
      <span class="flex-1" />
      <button
        class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors duration-100 cursor-pointer shrink-0 pointer-coarse:w-11 pointer-coarse:h-11 wco:app-no-drag"
        title="Search (Ctrl+Shift+F)"
        aria-label="Search"
        @click="emit('search')"
      >
        <Search :size="15" />
      </button>
      <slot />
    </template>
  </div>
</template>
