<!-- A look-alike of the editor's tab bar, shown for a moment at the top of the reader right after the
     Read/Edit switch flips to reading. It collapses upward (the content below slides up with it),
     so the tabs visibly leave instead of snapping away. Display only; emits `done` when finished. -->
<script setup lang="ts">
import { computed } from 'vue'
import { File, FileText, X } from 'lucide-vue-next'
import { useEditorStore } from '@/stores/editor'

const emit = defineEmits<{ done: [] }>()
const editorStore = useEditorStore()

const tabs = computed(() =>
  editorStore.tabOrder
    .map((id) => editorStore.openDocuments.get(id))
    .filter((doc) => doc != null)
    .map((doc) => ({
      id: doc.id,
      name: doc.name.replace(/\.[^.]+$/, ''),
      isMd: doc.type === 'md',
      active: doc.id === editorStore.activeDocumentId,
    })),
)
</script>

<template>
  <!-- Bottom-aligned inside a shrinking box: the bar's top is clipped first, so it slides upward. -->
  <div
    class="flex shrink-0 flex-col justify-end overflow-hidden animate-bar-collapse"
    aria-hidden="true"
    @animationend="emit('done')"
  >
    <div
      class="flex h-10 shrink-0 items-stretch overflow-hidden border-b border-border-subtle bg-surface"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="relative flex shrink-0 items-center gap-1.5 border-r border-border-subtle pr-1 pl-3 text-sm"
        :class="
          tab.active ? 'bg-tab-active-bg text-text-primary' : 'bg-surface text-text-secondary'
        "
      >
        <span v-if="tab.active" class="absolute right-0 bottom-0 left-0 h-0.5 bg-accent" />
        <FileText
          v-if="tab.isMd"
          :size="16"
          class="shrink-0"
          :class="tab.active ? 'text-accent' : 'text-text-muted'"
        />
        <File v-else :size="16" class="shrink-0 text-amber" />
        <span class="max-w-35 truncate font-ui text-sm">{{ tab.name }}</span>
        <span
          class="flex h-5 w-5 items-center justify-center text-text-muted"
          :class="tab.active ? 'opacity-60' : 'opacity-0'"
        >
          <X :size="16" />
        </span>
      </div>
    </div>
  </div>
</template>
