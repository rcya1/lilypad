<!-- Sticky margin TOC for wide screens, highlighting the heading in view. -->
<script setup lang="ts">
import type { TocItem } from '@/lib/markdown'

defineProps<{ toc: TocItem[]; activeId: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <nav class="flex flex-col py-6" aria-label="Table of contents">
    <span class="mb-3 pl-3 text-xs font-medium uppercase tracking-widest text-text-muted">
      On this page
    </span>
    <ul class="border-l border-border-subtle">
      <li v-for="item in toc" :key="item.id">
        <button
          class="-ml-px block w-full truncate border-l py-1 pr-2 text-left text-[13px] leading-snug transition-colors"
          :class="
            item.id === activeId
              ? 'border-accent text-accent'
              : 'border-transparent text-text-muted hover:text-text-primary'
          "
          :style="{ paddingLeft: (item.depth - 1) * 12 + 12 + 'px' }"
          :title="item.text"
          @click="emit('select', item.id)"
        >
          {{ item.text }}
        </button>
      </li>
    </ul>
  </nav>
</template>
