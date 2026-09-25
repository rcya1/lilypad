// Provide/inject between the reader shell and its child views (instead of a Pinia store): the note
// view fills in the title and TOC, and registers how to scroll to a heading.
import type { InjectionKey } from 'vue'
import type { TocItem } from '@/lib/markdown'
import { useFilesStore } from '@/stores/files'

export interface ReaderContext {
  /** Note name, or a not-found label. */
  title: string
  /** Empty when the note has no headings. */
  toc: TocItem[]
  /** The route is a real document (so the Edit switch can open it). */
  editable: boolean
  /** The docked sidebar is showing the tree. */
  sidebarVisible: boolean
  /** No-op until a note is mounted. */
  scrollToHeading: (id: string) => void
}

export const readerKey: InjectionKey<ReaderContext> = Symbol('reader')

// Shared so the note list and the note view never fetch the tree twice.
let entriesInflight: Promise<void> | null = null

/**
 * No-op if the tree is already loaded (e.g. by the editor). Concurrent callers share one request.
 */
export function ensureEntriesLoaded(): Promise<void> {
  const files = useFilesStore()
  if (files.entries.length > 0) return Promise.resolve()
  entriesInflight ??= files.fetchEntries().finally(() => {
    entriesInflight = null
  })
  return entriesInflight
}
