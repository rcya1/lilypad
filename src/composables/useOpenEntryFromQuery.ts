// Deep-link support for the desktop app: `/?open=<entryId>` opens that entry in the editor, then
// strips the param from the URL. Used by AppShell; the reader's "Edit" button links here.
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFilesStore } from '@/stores/files'
import { useEditorStore } from '@/stores/editor'
import { isSmallViewport } from '@/lib/viewport'

export function useOpenEntryFromQuery() {
  const route = useRoute()
  const router = useRouter()
  const filesStore = useFilesStore()
  const editorStore = useEditorStore()

  // Entry id waiting to be opened once the file tree is available.
  const pendingId = ref<string | null>(null)

  // The tree is usable once no fetch is in flight and at least one fetch has completed (entries
  // present, or indexReady set by a successful fetch that returned zero entries). On a cold load
  // FileExplorer starts that fetch on mount; coming from the reader it's usually already loaded.
  const entriesReady = computed(
    () => !filesStore.loading && (filesStore.entries.length > 0 || filesStore.indexReady),
  )

  watch(
    () => route.query.open,
    (open) => {
      if (typeof open !== 'string' || !open) return
      pendingId.value = open
      // Strip the params right away so a reload doesn't re-open the tab. Keep `desktop=1` on
      // small viewports — without it the router guard would bounce this URL back to the reader.
      const query = { ...route.query }
      delete query.open
      if (!isSmallViewport()) delete query.desktop
      router.replace({ path: route.path, query, hash: route.hash })
    },
    { immediate: true },
  )

  watch(
    [pendingId, entriesReady],
    ([id, ready]) => {
      if (!id || !ready) return
      pendingId.value = null
      // No-ops for unknown ids / folders, so a stale link just lands on the normal app.
      editorStore.openEntry(id)
      // Highlight it in the file tree too, matching the reader's highlight of the open note.
      if (filesStore.getEntry(id)) filesStore.selectSingle(id)
    },
    { immediate: true },
  )
}
