// `/?open=<entryId>` opens that entry in the editor, then drops the param. Used by AppShell (the
// reader's Read/Edit switch links here).
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

  const pendingId = ref<string | null>(null)

  // Ready once a fetch has finished: entries present, or indexReady set by one that returned none.
  const entriesReady = computed(
    () => !filesStore.loading && (filesStore.entries.length > 0 || filesStore.indexReady),
  )

  watch(
    () => route.query.open,
    (open) => {
      if (typeof open !== 'string' || !open) return
      pendingId.value = open
      // Drop the params now so a reload doesn't reopen the tab. Keep `desktop=1` on small screens,
      // or the router would bounce straight back to the reader.
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
      // No-op for unknown ids and folders.
      editorStore.openEntry(id)
      if (filesStore.getEntry(id)) filesStore.selectSingle(id)
    },
    { immediate: true },
  )
}
