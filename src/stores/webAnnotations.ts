// Pinia store for web-document highlights (annotations): loads/creates/updates/deletes rows in the
// `annotations` table and carries the cross-pane intent state (active/hovered highlight, and
// scroll requests in both directions) that links the captured page (WebView) with the notes pane.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import type { AnnotationRow, HighlightColor, HighlightSelectors } from '@/types/database'

/** Client-side view model for a highlight. `note` is normalised to '' (never null). */
export interface Highlight {
  id: string
  entryId: string
  /** Short per-document reference id (e.g. "hl-3") used in `lily:` note links. */
  localId: string
  color: HighlightColor
  selectors: HighlightSelectors
  note: string
  createdAt: string
}

/** Paint styles for each colour, applied inside the snapshot iframe via the Custom Highlight API. */
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

/** Next per-document short id: max existing "hl-<n>" + 1 (starting at 1). */
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

  /** All highlights loaded so far, across any entries opened this session. */
  const highlights = ref<Highlight[]>([])

  /** Entry ids whose highlights have been fetched (so we don't refetch on every open). */
  const loadedEntries = ref(new Set<string>())

  // ── Cross-pane intent ───────────────────────────────────────────────────────
  /** Highlight the user is focused on (clicked). Painted with the stronger `active` style. */
  const activeHighlightId = ref<string | null>(null)
  /** Highlight currently under the pointer (in page or notes). Emphasised on both sides. */
  const hoveredHighlightId = ref<string | null>(null)
  /** Request for the WebView to scroll the captured page to a highlight and pulse it. */
  const scrollToHighlightRequest = ref<string | null>(null)
  /** Request for the notes pane to scroll to the first `lily:` reference of a highlight. */
  const scrollToNoteRequest = ref<{ entryId: string; localId: string } | null>(null)

  /** Reactive accessor: highlights belonging to one entry, newest-anchored order preserved. */
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

  /**
   * Fetch highlights for an entry from Supabase (once per session unless `force`).
   * Populates `highlights` with the rows for this entry, replacing any stale copies.
   */
  async function loadForEntry(entryId: string, force = false): Promise<void> {
    if (!auth.user) return
    if (loadedEntries.value.has(entryId) && !force) return

    const { data, error } = await supabase
      .from('annotations')
      .select('*')
      .eq('entry_id', entryId)
      .order('created_at')
      .returns<AnnotationRow[]>()

    if (error) {
      toast.addToast('Failed to load highlights.', 'error')
      return
    }

    // Drop any existing rows for this entry, then insert the fresh set.
    highlights.value = highlights.value.filter((h) => h.entryId !== entryId)
    highlights.value.push(...(data ?? []).map(rowToHighlight))
    loadedEntries.value = new Set(loadedEntries.value).add(entryId)
  }

  /**
   * Create a highlight from serialized selectors. Assigns the next short `local_id`, inserts the
   * row, and appends it to local state. Returns the new highlight, or null on failure.
   */
  async function createHighlight(
    entryId: string,
    selectors: HighlightSelectors,
    color: HighlightColor,
  ): Promise<Highlight | null> {
    if (!auth.user) return null

    const localId = nextLocalId(highlightsFor(entryId))

    const { data, error } = await supabase
      .from('annotations')
      .insert({
        entry_id: entryId,
        user_id: auth.user.id,
        local_id: localId,
        color,
        selectors,
        note: null,
      })
      .select()
      .returns<AnnotationRow[]>()
      .single()

    if (error || !data) {
      toast.addToast('Failed to create highlight.', 'error')
      return null
    }

    const highlight = rowToHighlight(data)
    highlights.value.push(highlight)
    return highlight
  }

  /** Update the inline markdown note for a highlight. Mutates local state on success. */
  async function updateNote(id: string, note: string): Promise<boolean> {
    const { error } = await supabase
      .from('annotations')
      .update({ note: note || null })
      .eq('id', id)
    if (error) {
      toast.addToast('Failed to save note.', 'error')
      return false
    }
    const h = getById(id)
    if (h) h.note = note
    return true
  }

  /** Update a highlight's colour. Mutates local state on success. */
  async function updateColor(id: string, color: HighlightColor): Promise<boolean> {
    const { error } = await supabase.from('annotations').update({ color }).eq('id', id)
    if (error) {
      toast.addToast('Failed to update highlight.', 'error')
      return false
    }
    const h = getById(id)
    if (h) h.color = color
    return true
  }

  /** Delete a highlight. Removes it from local state on success. */
  async function deleteHighlight(id: string): Promise<boolean> {
    const { error } = await supabase.from('annotations').delete().eq('id', id)
    if (error) {
      toast.addToast('Failed to delete highlight.', 'error')
      return false
    }
    highlights.value = highlights.value.filter((h) => h.id !== id)
    if (activeHighlightId.value === id) activeHighlightId.value = null
    if (hoveredHighlightId.value === id) hoveredHighlightId.value = null
    return true
  }

  // ── Cross-pane setters ──────────────────────────────────────────────────────
  function setActiveHighlight(id: string | null) {
    activeHighlightId.value = id
  }
  function setHoveredHighlight(id: string | null) {
    hoveredHighlightId.value = id
  }
  /** Ask the WebView to scroll the captured page to this highlight and pulse it. */
  function requestScrollToHighlight(id: string) {
    scrollToHighlightRequest.value = id
  }
  /** Ask the notes pane to scroll to the first reference of this highlight. */
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
