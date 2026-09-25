// Pinia store for web-page highlights, plus the cross-pane state (active/hovered highlight, scroll
// requests) linking the captured page with its notes. Offline-first, like notes.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { loadAnnotations, saveAnnotations, type SyncOp } from '@/lib/offline'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import { useSyncStore } from './sync'
import type { AnnotationRow, HighlightColor, HighlightSelectors } from '@/types/database'

/** `note` is '' rather than null. */
export interface Highlight {
  id: string
  entryId: string
  /** Per-document short id ("hl-3") used in `lily:` links. */
  localId: string
  color: HighlightColor
  selectors: HighlightSelectors
  note: string
  createdAt: string
}

/** Applied inside the page iframe via the Custom Highlight API. */
export const HIGHLIGHT_COLORS: Record<
  HighlightColor,
  { base: string; active: string; swatch: string }
> = {
  amber: {
    base: 'rgba(245, 173, 74, 0.40)',
    active: 'rgba(245, 173, 74, 0.70)',
    swatch: '#e8a54a',
  },
  green: {
    base: 'rgba(115, 194, 115, 0.40)',
    active: 'rgba(115, 194, 115, 0.70)',
    swatch: '#5faf5f',
  },
  blue: {
    base: 'rgba(122, 170, 245, 0.40)',
    active: 'rgba(122, 170, 245, 0.70)',
    swatch: '#5b8fe0',
  },
  rose: {
    base: 'rgba(240, 140, 170, 0.40)',
    active: 'rgba(240, 140, 170, 0.70)',
    swatch: '#e07a9e',
  },
}

export const HIGHLIGHT_COLOR_KEYS = Object.keys(HIGHLIGHT_COLORS) as HighlightColor[]

function highlightToRow(h: Highlight, userId: string): AnnotationRow {
  return {
    id: h.id,
    entry_id: h.entryId,
    user_id: userId,
    local_id: h.localId,
    color: h.color,
    selectors: h.selectors,
    note: h.note || null,
    created_at: h.createdAt,
    updated_at: h.createdAt,
  }
}

function rowToHighlight(row: AnnotationRow): Highlight {
  return {
    id: row.id,
    entryId: row.entry_id,
    localId: row.local_id,
    color: row.color,
    selectors: row.selectors,
    note: row.note ?? '',
    createdAt: row.created_at,
  }
}

function nextLocalId(existing: Highlight[]): string {
  let max = 0
  for (const h of existing) {
    const m = /^hl-(\d+)$/.exec(h.localId)
    if (m) max = Math.max(max, parseInt(m[1]!, 10))
  }
  return `hl-${max + 1}`
}

export const useWebAnnotationsStore = defineStore('webAnnotations', () => {
  const auth = useAuthStore()
  const toast = useToastStore()
  const sync = useSyncStore()

  const highlights = ref<Highlight[]>([])

  /** Entries already fetched this session. */
  const loadedEntries = ref(new Set<string>())

  /** Clicked; painted with the stronger `active` tone. */
  const activeHighlightId = ref<string | null>(null)
  /** Under the pointer, in the page or the notes. */
  const hoveredHighlightId = ref<string | null>(null)
  /** For WebView: scroll the page to this highlight. */
  const scrollToHighlightRequest = ref<string | null>(null)
  /** For the notes: scroll to the highlight's first reference. */
  const scrollToNoteRequest = ref<{ entryId: string; localId: string } | null>(null)

  function highlightsFor(entryId: string): Highlight[] {
    return highlights.value.filter((h) => h.entryId === entryId)
  }

  const activeHighlight = computed(
    () => highlights.value.find((h) => h.id === activeHighlightId.value) ?? null,
  )

  function getById(id: string): Highlight | undefined {
    return highlights.value.find((h) => h.id === id)
  }

  function findByLocalId(entryId: string, localId: string): Highlight | undefined {
    return highlights.value.find((h) => h.entryId === entryId && h.localId === localId)
  }

  function persist(entryId: string) {
    if (!auth.user) return
    const uid = auth.user.id
    const rows = highlightsFor(entryId).map((h) => highlightToRow(h, uid))
    void saveAnnotations(uid, entryId, JSON.parse(JSON.stringify(rows)))
  }

  /** Queued local changes over freshly fetched rows (a fetch can land before they sync). */
  function withPendingChanges(entryId: string, rows: AnnotationRow[]): AnnotationRow[] {
    let result = [...rows]
    for (const op of sync.queue as SyncOp[]) {
      if (op.kind === 'hl-create' && op.row.entry_id === entryId) {
        if (!result.some((r) => r.id === op.row.id)) result.push(op.row)
      } else if (op.kind === 'hl-update') {
        result = result.map((r) => (r.id === op.id ? { ...r, ...op.fields } : r))
      } else if (op.kind === 'hl-delete') {
        result = result.filter((r) => r.id !== op.id)
      }
    }
    return result
  }

  /** Once per session unless `force`; from the device when offline. */
  async function loadForEntry(entryId: string, force = false): Promise<void> {
    if (!auth.user) return
    if (loadedEntries.value.has(entryId) && !force) return
    const uid = auth.user.id

    const { data, error } = await supabase
      .from('annotations')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at')
      .returns<AnnotationRow[]>()

    let rows: AnnotationRow[]
    if (error || !data) {
      const cached = await loadAnnotations(uid, entryId)
      if (!cached) {
        if (sync.online) toast.addToast('Failed to load highlights.', 'error')
        return
      }
      rows = cached
    } else {
      rows = withPendingChanges(entryId, data)
    }

    highlights.value = highlights.value.filter((h) => h.entryId !== entryId)
    highlights.value.push(...rows.map(rowToHighlight))
    loadedEntries.value = new Set(loadedEntries.value).add(entryId)
    persist(entryId)
  }

  /** Like the updates below: local at once, then synced (works offline). */
  async function createHighlight(
    entryId: string,
    selectors: HighlightSelectors,
    color: HighlightColor,
  ): Promise<Highlight | null> {
    if (!auth.user) return null

    const now = new Date().toISOString()
    const row: AnnotationRow = {
      id: crypto.randomUUID(),
      entry_id: entryId,
      user_id: auth.user.id,
      local_id: nextLocalId(highlightsFor(entryId)),
      color,
      selectors,
      note: null,
      created_at: now,
      updated_at: now,
    }
    highlights.value.push(rowToHighlight(row))
    sync.enqueue({ kind: 'hl-create', row })
    persist(entryId)
    return highlights.value[highlights.value.length - 1]!
  }

  async function updateNote(id: string, note: string): Promise<boolean> {
    const h = getById(id)
    if (!h) return false
    h.note = note
    sync.enqueue({ kind: 'hl-update', id, fields: { note: note || null } })
    persist(h.entryId)
    return true
  }

  async function updateColor(id: string, color: HighlightColor): Promise<boolean> {
    const h = getById(id)
    if (!h) return false
    h.color = color
    sync.enqueue({ kind: 'hl-update', id, fields: { color } })
    persist(h.entryId)
    return true
  }

  async function deleteHighlight(id: string): Promise<boolean> {
    const h = getById(id)
    if (!h) return false
    sync.enqueue({ kind: 'hl-delete', id })
    highlights.value = highlights.value.filter((x) => x.id !== id)
    persist(h.entryId)
    if (activeHighlightId.value === id) activeHighlightId.value = null
    if (hoveredHighlightId.value === id) hoveredHighlightId.value = null
    return true
  }

  function setActiveHighlight(id: string | null) {
    activeHighlightId.value = id
  }
  function setHoveredHighlight(id: string | null) {
    hoveredHighlightId.value = id
  }
  function requestScrollToHighlight(id: string) {
    scrollToHighlightRequest.value = id
  }
  function requestScrollToNote(entryId: string, localId: string) {
    scrollToNoteRequest.value = { entryId, localId }
  }

  function $reset() {
    highlights.value = []
    loadedEntries.value = new Set()
    activeHighlightId.value = null
    hoveredHighlightId.value = null
    scrollToHighlightRequest.value = null
    scrollToNoteRequest.value = null
  }

  return {
    highlights,
    activeHighlightId,
    hoveredHighlightId,
    activeHighlight,
    scrollToHighlightRequest,
    scrollToNoteRequest,
    highlightsFor,
    getById,
    findByLocalId,
    loadForEntry,
    createHighlight,
    updateNote,
    updateColor,
    deleteHighlight,
    setActiveHighlight,
    setHoveredHighlight,
    requestScrollToHighlight,
    requestScrollToNote,
    $reset,
  }
})
