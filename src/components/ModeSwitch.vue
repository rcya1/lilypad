<!-- Read / Edit switch: a compact pill with a book and a pen icon and a filled thumb that slides to
     the active mode. Sits next to the Lilypad wordmark in both the editor sidebar and the reader so
     it never moves when you flip. The parent decides where each mode navigates. -->
<script lang="ts">
export type AppMode = 'read' | 'edit'

// Flipping navigates to the other screen right away, which unmounts this switch before its thumb
// could slide. So the flip is handed over: the switch that mounts on the next screen starts on the
// old side and plays the slide there. Module-level, shared by every instance.
let arrivingMode: AppMode | null = null
</script>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { BookOpen, PenLine } from 'lucide-vue-next'

const props = defineProps<{ mode: AppMode }>()
const emit = defineEmits<{ change: [mode: AppMode] }>()

const other = (mode: AppMode): AppMode => (mode === 'read' ? 'edit' : 'read')

// Arriving via a flip: render on the previous side first, then slide over once painted.
const shown = ref<AppMode>(arrivingMode === props.mode ? other(props.mode) : props.mode)
arrivingMode = null

onMounted(() => {
  if (shown.value === props.mode) return
  // Two frames: one to paint the starting side, the next to start the transition from it.
  requestAnimationFrame(() => requestAnimationFrame(() => (shown.value = props.mode)))
})

watch(
  () => props.mode,
  (mode) => (shown.value = mode),
)

function flip() {
  const next = other(props.mode)
  shown.value = next
  arrivingMode = next
  emit('change', next)
}
</script>

<template>
  <button
    role="switch"
    :aria-checked="shown === 'edit'"
    aria-label="Edit mode"
    :title="shown === 'read' ? 'Switch to editing' : 'Switch to reading'"
    class="group relative grid h-7 w-15 shrink-0 cursor-pointer grid-cols-2 rounded-full bg-surface-elevated p-0.5 pointer-coarse:h-9 pointer-coarse:w-19"
    @click="flip"
  >
    <span
      class="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-accent shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.3,0.7,0.2,1)] motion-reduce:transition-none"
      :class="shown === 'edit' ? 'translate-x-full' : ''"
    />
    <span
      class="relative flex items-center justify-center transition-colors duration-200"
      :class="shown === 'read' ? 'text-bg' : 'text-text-muted group-hover:text-text-secondary'"
    >
      <BookOpen :size="13" :stroke-width="2.2" />
    </span>
    <span
      class="relative flex items-center justify-center transition-colors duration-200"
      :class="shown === 'edit' ? 'text-bg' : 'text-text-muted group-hover:text-text-secondary'"
    >
      <PenLine :size="13" :stroke-width="2.2" />
    </span>
  </button>
</template>
