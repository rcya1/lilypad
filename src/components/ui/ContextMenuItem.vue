<!-- A ContextMenu row; `icon` is a lucide component, `danger` for destructive actions. -->
<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(defineProps<{ danger?: boolean; icon?: Component }>(), { danger: false })

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="group flex w-full items-center gap-2.5 whitespace-nowrap px-2.5 py-1.5 text-left text-sm transition-colors duration-75 cursor-pointer"
    :class="
      danger
        ? 'text-red-600 hover:bg-red-500/10'
        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
    "
    @click="emit('click')"
  >
    <component
      :is="icon"
      v-if="icon"
      :size="15"
      class="shrink-0 transition-colors duration-75"
      :class="danger ? 'text-red-600' : 'text-text-muted group-hover:text-text-primary'"
    />
    <span class="truncate"><slot /></span>
  </button>
</template>
