<!-- Single row inside a ContextMenu; set `danger` for destructive actions (e.g. Delete). -->
<script setup lang="ts">
withDefaults(defineProps<{ danger?: boolean }>(), { danger: false })

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer"
    :class="
      danger
        ? 'text-red-600 hover:bg-surface-elevated'
        : 'text-text-secondary hover:bg-surface-elevated hover:text-text-primary'
    "
    @click="emit('click')"
  >
    <slot />
  </button>
</template>
