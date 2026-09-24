<!-- Route component for /read, /read/search and /read/:entryId. Layout: the reader sidebar (logo,
     Read/Edit switch, note tree) docked on the left on wide screens or as a drawer on narrow ones,
     and a main column with a top bar + breadcrumb bar over the child route. The child route fills
     in title/toc via the injected reader context. A separate tree from the desktop AppShell, but on
     wide screens its sidebar and bars are built to the editor's geometry (shared width/minimized
     state from the ui store, same bar heights) so flipping Read/Edit doesn't shift the layout. -->
<script setup lang="ts">
import {
  reactive,
  provide,
  ref,
  computed,
  watch,
  watchEffect,
  onMounted,
  onBeforeUnmount,
  useTemplateRef,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { PanelLeft, Search, TableOfContents } from 'lucide-vue-next'
import LilypadIcon from '@/assets/icon.svg'
import ModeSwitch from '@/components/ModeSwitch.vue'
import { useFilesStore } from '@/stores/files'
import { useUiStore } from '@/stores/ui'
import { isSmallViewport } from '@/lib/viewport'
import SidebarResizeHandle from '@/components/sidebar/SidebarResizeHandle.vue'
import ReaderSidebar from './ReaderSidebar.vue'
import ReaderBreadcrumbs from './ReaderBreadcrumbs.vue'
import ReaderTocSheet from './ReaderTocSheet.vue'
import ReaderTabGhost from './ReaderTabGhost.vue'
import { useEditorStore } from '@/stores/editor'
import { readerKey, type ReaderContext } from './context'

const route = useRoute()
const router = useRouter()
const filesStore = useFilesStore()
const uiStore = useUiStore()

const reader = reactive<ReaderContext>({
  title: '',
  toc: [],
  editable: false,
  sidebarVisible: false,
  scrollToHeading: () => {},
})
provide(readerKey, reader)

// Top-bar icon buttons: 44px touch targets, tighter on mouse/trackpad screens.
const iconButton =
  'flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary active:bg-surface-overlay pointer-fine:h-7 pointer-fine:w-7'

const isDocument = computed(() => route.name === 'reader-document')
const isSearch = computed(() => route.name === 'reader-search')
const entryId = computed(() =>
  typeof route.params.entryId === 'string' ? route.params.entryId : null,
)

// ── Sidebar ─────────────────────────────────────────────────────────────────────────────────────
// Wide screens dock the sidebar with the editor's width + minimized state (shared via the ui
// store); narrow ones use a drawer instead.
const WIDE_QUERY = '(min-width: 1024px)'
// Matches LilypadSidebar's icon-only rail.
const MINIMIZED_WIDTH = 64
const DRAWER_WIDTH = 288
const wideMedia = window.matchMedia(WIDE_QUERY)
const isWide = ref(wideMedia.matches)
const onWideChange = (e: MediaQueryListEvent) => (isWide.value = e.matches)

const { sidebarWidth, sidebarMinimized, sidebarResizing } = storeToRefs(uiStore)
const drawerOpen = ref(false)

// The tree is on screen in the docked sidebar (so the note list doesn't need to repeat it).
const sidebarVisible = computed(() => isWide.value && !sidebarMinimized.value)

// Arriving from the editor via the Read/Edit switch on a wide screen: show a copy of its tab bar
// and collapse it upward, so the tabs slide away rather than snap (the editor mirrors this).
const showTabGhost = ref(
  uiStore.arrivedViaModeSwitch('to-read') && isWide.value && useEditorStore().tabOrder.length > 0,
)
watchEffect(() => (reader.sidebarVisible = sidebarVisible.value))

function toggleSidebar() {
  if (isWide.value) sidebarMinimized.value = !sidebarMinimized.value
  else drawerOpen.value = !drawerOpen.value
}

function showSidebar() {
  if (isWide.value) sidebarMinimized.value = false
  else drawerOpen.value = true
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && drawerOpen.value) drawerOpen.value = false
  // Same shortcut as the editor sidebar.
  if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
    e.preventDefault()
    toggleSidebar()
  }
}

// ── Breadcrumbs + tree reveal ───────────────────────────────────────────────────────────────────
const ancestors = computed(() =>
  entryId.value && filesStore.getEntry(entryId.value)
    ? filesStore.getAncestorPath(entryId.value)
    : [],
)

function expandPath(folderIds: string[]) {
  for (const id of folderIds) filesStore.expandFolder(id)
}

// Keep the open note visible in the tree: expand its folders once the tree has loaded.
watch(
  [entryId, () => filesStore.entries.length],
  () => expandPath(ancestors.value.map((a) => a.id)),
  { immediate: true },
)

/** Folder crumb → expand it (and its parents) in the tree and bring the sidebar up. */
function revealFolder(id: string) {
  expandPath([...filesStore.getAncestorPath(id).map((a) => a.id), id])
  showSidebar()
}

// ── TOC ─────────────────────────────────────────────────────────────────────────────────────────
// ReaderDocument shows the TOC as a margin rail once its container is ≥ 60rem wide (container
// query); below that, the bar's TOC button opens the bottom sheet. Track the same width here.
const RAIL_MIN_WIDTH = 960
const mainColumn = useTemplateRef<HTMLDivElement>('mainColumn')
const mainWidth = ref(0)
const resizeObserver = new ResizeObserver(([entry]) => {
  if (entry) mainWidth.value = entry.contentRect.width
})
const showTocButton = computed(
  () => isDocument.value && reader.toc.length > 0 && mainWidth.value < RAIL_MIN_WIDTH,
)
const tocOpen = ref(false)

function onSelectHeading(id: string) {
  reader.scrollToHeading(id)
  tocOpen.value = false
}

// Close the sheet and drawer on any navigation (e.g. picking a note, browser back).
watch(
  () => route.path,
  () => {
    tocOpen.value = false
    drawerOpen.value = false
  },
)

// ── Navigation ──────────────────────────────────────────────────────────────────────────────────
// Read/Edit switch → the desktop editor, with this note open when there is one. `desktop=1` opts
// out of the small-viewport redirect; AppShell's useOpenEntryFromQuery opens the entry and cleans
// the URL.
function openInEditor() {
  const query: Record<string, string> = {}
  if (isDocument.value && reader.editable && entryId.value) query.open = entryId.value
  if (isSmallViewport()) query.desktop = '1'
  uiStore.markModeSwitch('to-edit')
  router.push({ name: 'app', query })
}

function openSearch() {
  router.push({ name: 'reader-search' })
}

// Sidebar "Images" tab → the editor's Images tab (images live there).
function openImagesInEditor() {
  uiStore.sidebarTab = 'images'
  openInEditor()
}

onMounted(() => {
  wideMedia.addEventListener('change', onWideChange)
  window.addEventListener('keydown', onKeydown)
  if (mainColumn.value) resizeObserver.observe(mainColumn.value)
})

onBeforeUnmount(() => {
  wideMedia.removeEventListener('change', onWideChange)
  window.removeEventListener('keydown', onKeydown)
  resizeObserver.disconnect()
})
</script>

<template>
  <div class="flex h-dvh bg-bg font-ui text-text-primary">
    <!-- Docked sidebar (wide screens) — same shell, width transition and draggable edge as
         LilypadSidebar (drag to resize, drag past the snap point to minimize). -->
    <aside
      class="relative hidden shrink-0 border-r border-border-subtle bg-surface lg:block"
      :class="{ 'transition-[width] duration-200 ease-in-out': !sidebarResizing }"
      :style="{ width: (sidebarMinimized ? MINIMIZED_WIDTH : sidebarWidth) + 'px' }"
    >
      <div class="h-full overflow-hidden">
        <ReaderSidebar
          :minimized="sidebarMinimized"
          :width="sidebarWidth"
          @edit="openInEditor"
          @search="openSearch"
          @images="openImagesInEditor"
        />
      </div>
      <SidebarResizeHandle />
    </aside>

    <div ref="mainColumn" class="@container flex min-w-0 flex-1 flex-col">
      <!-- The search view renders its own bar (back + input). -->
      <header v-if="!isSearch" class="shrink-0 bg-surface pt-[env(safe-area-inset-top)]">
        <ReaderTabGhost v-if="showTabGhost" @done="showTabGhost = false" />
        <!-- Narrow screens only: there's no docked sidebar, so this bar holds the drawer button,
             logo, Read/Edit switch, search and TOC. Wide screens get just the breadcrumb bar. -->
        <div v-if="!isWide" class="flex h-14 items-center gap-1 border-b border-border-subtle px-2">
          <button :class="iconButton" aria-label="Open sidebar" @click="toggleSidebar">
            <PanelLeft :size="16" />
          </button>
          <div class="flex shrink-0 items-center gap-2 pr-1 pl-1">
            <LilypadIcon class="h-6 w-6 shrink-0" />
            <span class="font-display text-lg leading-none font-medium text-text-primary">
              Lilypad
            </span>
            <ModeSwitch mode="read" class="ml-0.5" @change="openInEditor" />
          </div>
          <span class="flex-1" />
          <button :class="iconButton" aria-label="Search notes" @click="openSearch">
            <Search :size="16" />
          </button>
          <button
            v-if="showTocButton"
            :class="iconButton"
            aria-label="Table of contents"
            @click="tocOpen = true"
          >
            <TableOfContents :size="16" />
          </button>
        </div>

        <!-- Same height/fill as the editor's BreadcrumbBar. -->
        <div
          v-if="isDocument"
          class="flex h-9 items-center gap-2 border-b border-border-subtle px-3 pointer-fine:h-7"
        >
          <ReaderBreadcrumbs
            class="min-w-0 flex-1 overflow-x-auto"
            :ancestors="ancestors"
            :current="reader.title"
            @folder="revealFolder"
          />
          <!-- Wide screens: TOC button for when the note area is too narrow for the margin rail. -->
          <button
            v-if="isWide && showTocButton"
            class="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors duration-100 hover:bg-surface-elevated hover:text-text-primary"
            title="Table of contents"
            aria-label="Table of contents"
            @click="tocOpen = true"
          >
            <TableOfContents :size="14" />
          </button>
        </div>
      </header>

      <!-- Keyed by route name so moving between notes doesn't replay the page transition (the
           document view fades its own content in instead). -->
      <router-view v-slot="{ Component, route: r }">
        <Transition name="reader-page" mode="out-in">
          <component :is="Component" :key="r.name" />
        </Transition>
      </router-view>
    </div>

    <!-- Drawer sidebar (narrow screens) -->
    <Teleport to="body">
      <div class="lg:hidden">
        <Transition name="scrim">
          <div
            v-if="drawerOpen"
            class="fixed inset-0 z-40 bg-black/30"
            @click="drawerOpen = false"
          />
        </Transition>
        <Transition name="drawer">
          <div
            v-if="drawerOpen"
            class="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-hidden border-r border-border-subtle font-ui text-text-primary shadow-xl"
          >
            <ReaderSidebar
              :minimized="false"
              :width="DRAWER_WIDTH"
              @edit="openInEditor"
              @search="openSearch"
              @images="openImagesInEditor"
            />
          </div>
        </Transition>
      </div>
    </Teleport>

    <ReaderTocSheet
      :toc="reader.toc"
      :open="tocOpen"
      @select="onSelectHeading"
      @close="tocOpen = false"
    />
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .reader-page-enter-active,
  .reader-page-leave-active {
    transition:
      opacity 160ms ease,
      transform 160ms ease;
  }
  .reader-page-enter-from {
    opacity: 0;
    transform: translateY(6px);
  }
  .reader-page-leave-to {
    opacity: 0;
  }

  .scrim-enter-active,
  .scrim-leave-active {
    transition: opacity 200ms ease;
  }
  .scrim-enter-from,
  .scrim-leave-to {
    opacity: 0;
  }

  .drawer-enter-active,
  .drawer-leave-active {
    transition: transform 240ms cubic-bezier(0.3, 0.7, 0.2, 1);
  }
  .drawer-enter-from,
  .drawer-leave-to {
    transform: translateX(-100%);
  }
}
</style>
