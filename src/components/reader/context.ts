// Provide/inject bridge between the reader shell (owns the app bar) and the document view (parses
// the note). Keeps preview mode free of a new Pinia store — the shell provides a reactive context
// that ReaderDocument fills in with the current note's title, TOC, and a scroll callback.
import type { InjectionKey } from 'vue'
import type { TocItem } from '@/lib/markdown'

export interface ReaderContext {
  /** Display title shown in the app bar (note name, or a not-found label). */
  title: string
  /** Headings of the current note; drives the TOC button + sheet. Empty when none. */
  toc: TocItem[]
  /** Scrolls the document view to a heading id. No-op until a document is mounted. */
  scrollToHeading: (id: string) => void
}

export const readerKey: InjectionKey<ReaderContext> = Symbol('reader')
