<!-- Fixed-position context menu shell; caller provides items via the default slot. -->
<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ x: number; y: number }>()

const rootEl = ref<HTMLDivElement>()
defineExpose({ el: rootEl })
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootEl"
      class="fixed z-50 w-max min-w-[7.5rem] max-w-64 bg-bg border border-border rounded-lg shadow-lg py-1 font-ui"
      :style="{ left: x + 'px', top: y + 'px' }"
    >
      <slot />
    </div>
  </Teleport>
</template>
