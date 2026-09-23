<!-- Route component for /read and /read/:entryId. Owns the sticky app bar (contents driven by the
     child route) and the TOC bottom sheet; the child route fills in title/toc via the injected
     reader context. A completely separate tree from the desktop AppShell. -->
<script setup lang="ts">
import { reactive, provide, ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, TableOfContents } from 'lucide-vue-next'
import LilypadIcon from '@/assets/icon.svg'
import ReaderTocSheet from './ReaderTocSheet.vue'
import { readerKey, type ReaderContext } from './context'

const route = useRoute()
const router = useRouter()

const reader = reactive<ReaderContext>({ title: '', toc: [], scrollToHeading: () => {} })
provide(readerKey, reader)

const isDocument = computed(() => route.name === 'reader-document')
const tocOpen = ref(false)

// Close the sheet on any navigation (e.g. browser back while it's open) so it doesn't linger,
// empty, over the next view.
watch(
  () => route.path,
  () => (tocOpen.value = false),
)

// If we came from the tree, pop back to it so history stays linear (no tree → note → tree →
// note loop on the browser back button); otherwise (deep link, from search) push the tree.
function goBack() {
  const back = (window.history.state as { back?: string | null } | null)?.back
  if (back && router.resolve(back).name === 'reader-browser') router.back()
  else router.push({ name: 'reader-browser' })
}

function onSelectHeading(id: string) {
  reader.scrollToHeading(id)
  tocOpen.value = false
}
</script>

<template>
  <div class="flex h-dvh flex-col bg-bg font-ui text-text-primary">
    <header
      class="flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-2 pt-[env(safe-area-inset-top)]"
    >
      <div class="flex h-14 w-full items-center gap-1">
        <template v-if="isDocument">
          <button
            class="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary active:bg-surface-elevated"
            aria-label="Back to notes"
            @click="goBack"
          >
            <ArrowLeft :size="20" />
          </button>
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
            {{ reader.title }}
          </span>
          <button
            v-if="reader.toc.length"
            class="flex h-11 w-11 items-center justify-center rounded-lg text-text-secondary active:bg-surface-elevated"
            aria-label="Table of contents"
            @click="tocOpen = true"
          >
            <TableOfContents :size="20" />
          </button>
        </template>
        <template v-else>
          <LilypadIcon class="ml-1 h-8 w-8 shrink-0" />
          <span class="ml-2 font-display text-xl font-medium text-text-primary">Lilypad</span>
        </template>
      </div>
    </header>

    <router-view />

    <ReaderTocSheet
      :toc="reader.toc"
      :open="tocOpen"
      @select="onSelectHeading"
      @close="tocOpen = false"
    />
  </div>
</template>
