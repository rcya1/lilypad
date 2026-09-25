// On-device storage for offline use (IndexedDB), keyed per user so accounts never mix and sign-out
// can wipe one: the tree snapshot with merge bases, the sync queue, conflicts, and each web page's
// highlights. Also the sync queue's op types.
import { createStore, get, set, del, keys, delMany } from 'idb-keyval'
import type { AnnotationRow, EntryRow, HighlightColor } from '@/types/database'

const store = createStore('lilypad-offline', 'kv')

/** The server's copy of a note as last seen: the base for three-way merges. */
export interface NoteBase {
  /** Null until the versioning migration is applied. */
  version: number | null
  content: string
}

export interface OfflineSnapshot {
  entries: EntryRow[]
  bases: Record<string, NoteBase>
}

/** Merged per field; the latest change wins. */
export interface EntryFieldUpdate {
  name?: string
  parent_id?: string | null
  sort_order?: number
}

export interface HighlightFieldUpdate {
  note?: string | null
  color?: HighlightColor
}

export type SyncOp =
  | { kind: 'create'; row: EntryRow }
  | { kind: 'update'; id: string; fields: EntryFieldUpdate }
  | { kind: 'delete'; id: string; storagePaths: string[] }
  /** Pushes the text as it is at sync time, so one op covers many edits. */
  | { kind: 'content'; id: string }
  | { kind: 'hl-create'; row: AnnotationRow }
  | { kind: 'hl-update'; id: string; fields: HighlightFieldUpdate }
  | { kind: 'hl-delete'; id: string }

export function opTarget(op: SyncOp): string {
  return op.kind === 'create' || op.kind === 'hl-create' ? op.row.id : op.id
}

/**
 * Folds `op` into earlier ops for the same target so long offline sessions stay small: creates
 * absorb updates, updates merge per field, one content op per note, and a delete drops earlier
 * ops (cancelling an unsynced create outright). Returns a new array.
 */
export function enqueueOp(queue: SyncOp[], op: SyncOp): SyncOp[] {
  const target = opTarget(op)
  const next = [...queue]

  switch (op.kind) {
    case 'content': {
      return next.some((o) => o.kind === 'content' && o.id === target) ? next : [...next, op]
    }
    case 'update':
    case 'hl-update': {
      const createKind = op.kind === 'update' ? 'create' : 'hl-create'
      const created = next.find((o) => o.kind === createKind && opTarget(o) === target) as
        | Extract<SyncOp, { kind: 'create' | 'hl-create' }>
        | undefined
      if (created) {
        Object.assign(created, { row: { ...created.row, ...op.fields } })
        return next
      }
      const i = next.findIndex((o) => o.kind === op.kind && o.id === target)
      if (i !== -1) {
        const prev = next[i] as typeof op
        next[i] = { ...prev, fields: { ...prev.fields, ...op.fields } } as SyncOp
        return next
      }
      return [...next, op]
    }
    case 'delete':
    case 'hl-delete': {
      const createKind = op.kind === 'delete' ? 'create' : 'hl-create'
      const createdHere = next.some((o) => o.kind === createKind && opTarget(o) === target)
      const rest = next.filter((o) => opTarget(o) !== target)
      // Never reached the server: dropping its create is the whole delete.
      return createdHere ? rest : [...rest, op]
    }
    default:
      return [...next, op]
  }
}

const k = (userId: string, name: string) => `${userId}:${name}`

export const loadSnapshot = (userId: string) => get<OfflineSnapshot>(k(userId, 'snapshot'), store)
export const saveSnapshot = (userId: string, snapshot: OfflineSnapshot) =>
  set(k(userId, 'snapshot'), snapshot, store)

export const loadQueue = async (userId: string) =>
  (await get<SyncOp[]>(k(userId, 'queue'), store)) ?? []
export const saveQueue = (userId: string, queue: SyncOp[]) => set(k(userId, 'queue'), queue, store)

export const loadConflicts = async (userId: string) =>
  (await get<string[]>(k(userId, 'conflicts'), store)) ?? []
export const saveConflicts = (userId: string, ids: string[]) =>
  set(k(userId, 'conflicts'), ids, store)

export const loadAnnotations = (userId: string, entryId: string) =>
  get<AnnotationRow[]>(k(userId, `annotations:${entryId}`), store)
export const saveAnnotations = (userId: string, entryId: string, rows: AnnotationRow[]) =>
  set(k(userId, `annotations:${entryId}`), rows, store)
export const deleteAnnotations = (userId: string, entryId: string) =>
  del(k(userId, `annotations:${entryId}`), store)

/** Service-worker caches of opened images and pages (see vite.config.ts). */
export const USER_MEDIA_CACHES = ['lilypad-images', 'lilypad-pages']

/** IndexedDB data and the cached images/pages. */
export async function wipeUser(userId: string): Promise<void> {
  const mine = (await keys(store)).filter((key) => String(key).startsWith(`${userId}:`))
  await delMany(mine, store)
  if ('caches' in window) await Promise.all(USER_MEDIA_CACHES.map((name) => caches.delete(name)))
}

// The last signed-in user, so the app can open offline when the session can't be refreshed.

const LAST_USER_KEY = 'lilypad.lastUser'

export interface CachedUser {
  id: string
  email: string | null
}

export function rememberUser(user: CachedUser) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user))
  } catch {
    // Unavailable: offline start just won't work in this browser.
  }
}

export function recallUser(): CachedUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY)
    return raw ? (JSON.parse(raw) as CachedUser) : null
  } catch {
    return null
  }
}

export function forgetUser() {
  try {
    localStorage.removeItem(LAST_USER_KEY)
  } catch {
    // Nothing to clean up.
  }
}
