<!-- Accessible on/off switch bound via v-model. -->
<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button
    role="switch"
    :aria-checked="model"
    class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
    :class="model ? 'bg-accent' : 'bg-surface-overlay'"
    @click="model = !model"
  >
    <span
      class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
      :class="model ? 'translate-x-4' : 'translate-x-0'"
    />
  </button>
</template>
