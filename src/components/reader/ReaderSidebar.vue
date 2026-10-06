<!-- Reader sidebar, built to the editor sidebar's exact geometry (shared header, footer and width,
     same tab row, section header and row metrics) so flipping Read/Edit doesn't move anything. -->
<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import { ref } from 'vue'
import { ChevronsDownUp, ChevronsUpDown, FilePlus, FolderPlus, Download } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import SidebarHeader from '@/components/sidebar/SidebarHeader.vue'
import SidebarFooter from '@/components/sidebar/SidebarFooter.vue'
import ReaderTree from './ReaderTree.vue'

defineProps<{ minimized: boolean; width: number }>()
const emit = defineEmits<{ edit: []; search: []; images: [] }>()

const filesStore = useFilesStore()
const uiStore = useUiStore()

// Arriving from the editor, a copy of its new-file buttons shrinks away so "collapse all" slides
// into place instead of jumping.
const showActionsGhost = ref(uiStore.arrivedViaModeSwitch('to-read'))

const totalFolderCount = computed(
  () => filesStore.entries.filter((e) => e.kind === 'directory').length,
)
const anyExpanded = computed(() => filesStore.collapsedFolderIds.size < totalFolderCount.value)

function toggleAllFolders() {
  if (anyExpanded.value) filesStore.collapseAll()
  else filesStore.expandAll()
}

// Shared with the editor's file tree.
const scroller = useTemplateRef<HTMLDivElement>('scroller')
function onScroll() {
  if (scroller.value) uiStore.sidebarScrollTop = scroller.value.scrollTop
}
onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = uiStore.sidebarScrollTop
})
</script>

<template>
  <div class="flex h-full flex-col bg-surface pt-[env(safe-area-inset-top)]">
    <SidebarHeader
      mode="read"
      :minimized="minimized"
      :width="width"
      @switch="emit('edit')"
      @search="emit('search')"
    />
    <div class="border-t border-border-subtle" />

    <template v-if="!minimized">
      <div class="relative flex flex-1 flex-col overflow-hidden">
        <!-- Images live in the editor, so that tab flips over to it -->
        <div class="flex shrink-0 border-b border-border-subtle">
          <button
            class="relative flex-1 cursor-pointer py-1.5 text-center text-xs font-medium text-text-primary"
          >
            Files
            <div class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-accent" />
          </button>
          <button
            class="relative flex-1 cursor-pointer py-1.5 text-center text-xs font-medium text-text-muted transition-colors duration-100 hover:text-text-secondary"
            title="Images open in the editor"
            @click="emit('images')"
          >
            Images
          </button>
        </div>

        <div ref="scroller" class="flex flex-1 flex-col overflow-y-auto" @scroll.passive="onScroll">
          <!-- h-9: the editor's row gets its height from its action buttons -->
          <div class="flex h-9 shrink-0 items-center justify-between px-3">
            <span class="text-xs font-medium tracking-widest text-text-muted uppercase">Files</span>
            <div class="flex items-center gap-0.5">
              <button
                v-if="totalFolderCount > 0"
                class="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-text-muted transition-colors duration-100 hover:bg-surface-elevated hover:text-text-primary"
                :title="anyExpanded ? 'Collapse all' : 'Expand all'"
                @click="toggleAllFolders"
              >
                <ChevronsDownUp v-if="anyExpanded" :size="16" />
                <ChevronsUpDown v-else :size="16" />
              </button>
              <span
                v-if="showActionsGhost"
                class="flex animate-actions-out items-center gap-0.5 overflow-hidden"
                aria-hidden="true"
                @animationend="showActionsGhost = false"
              >
                <span class="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted">
                  <FilePlus :size="16" />
                </span>
                <span class="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted">
                  <FolderPlus :size="16" />
                </span>
                <span class="flex h-5 w-5 shrink-0 items-center justify-center text-text-muted">
                  <Download :size="16" />
                </span>
              </span>
            </div>
          </div>
          <ReaderTree />
        </div>
      </div>

      <SidebarFooter />
    </template>
  </div>
</template>
