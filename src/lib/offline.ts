// On-device storage for offline use (IndexedDB via idb-keyval), and the sync queue's operation
// types. Everything is keyed per user so two accounts on one browser never see each other's data,
// and sign-out can wipe exactly one user's copy.
//
// What's stored per user:
//   snapshot       — every entry row (with local note text) + the last-synced server copy of each
//                    note ("bases", the common ancestor for three-way merges)
//   queue          — changes made on this device not yet applied on the server, in order
//   conflicts      — ids of notes holding unresolved merge conflicts
//   annotations:ID — highlights of one web document
import { createStore, get, set, del, keys, delMany } from 'idb-keyval'
import type { AnnotationRow, EntryRow, HighlightColor } from '@/types/database'

const store = createStore('lilypad-offline', 'kv')

/** The server's copy of a note as this device last saw it — the base for three-way merges. */
export interface NoteBase {
  /** `entries.version` at that point; null until the versioning migration is applied. */
  version: number | null
  content: string
}

export interface OfflineSnapshot {
  entries: EntryRow[]
  bases: Record<string, NoteBase>
}

/** Entry fields a rename/move/reorder changes (merged per field; the latest change wins). */
export interface EntryFieldUpdate {
  name?: string
  parent_id?: string | null
  sort_order?: number
}

export interface HighlightFieldUpdate {
  note?: string | null
  color?: HighlightColor
}

/** One pending change, replayed against the server in queue order. */
export type SyncOp =
  | { kind: 'create'; row: EntryRow }
  | { kind: 'update'; id: string; fields: EntryFieldUpdate }
  | { kind: 'delete'; id: string; storagePaths: string[] }
  /** Push the note's current local text (read at sync time, so one op covers many edits). */
  | { kind: 'content'; id: string }
  | { kind: 'hl-create'; row: AnnotationRow }
  | { kind: 'hl-update'; id: string; fields: HighlightFieldUpdate }
  | { kind: 'hl-delete'; id: string }

/** The entry or highlight id an op is about. */
export function opTarget(op: SyncOp): string {
  return op.kind === 'create' || op.kind === 'hl-create' ? op.row.id : op.id
}

/**
 * Adds `op` to `queue`, folding it into earlier ops for the same target where possible so the
 * queue stays small across long offline sessions:
 * - a create absorbs later updates (and a later delete cancels it and everything after it);
 * - updates merge field by field (latest value wins);
 * - one content op per note (it pushes whatever the text is at sync time);
 * - a delete drops that target's earlier updates/content pushes.
 * Returns a new array.
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

// ── Persistence ────────────────────────────────────────────────────────────────────────────────

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

/** Service-worker caches holding this user's opened images and captured pages (see vite.config). */
export const USER_MEDIA_CACHES = ['lilypad-images', 'lilypad-pages']

/** Deletes everything stored for `userId`: IndexedDB data and the cached images/pages. */
export async function wipeUser(userId: string): Promise<void> {
  const mine = (await keys(store)).filter((key) => String(key).startsWith(`${userId}:`))
  await delMany(mine, store)
  if ('caches' in window) await Promise.all(USER_MEDIA_CACHES.map((name) => caches.delete(name)))
}

// ── Last signed-in user (lets the app open offline when the session can't be refreshed) ───────

const LAST_USER_KEY = 'lilypad.lastUser'

export interface CachedUser {
  id: string
  email: string | null
}

export function rememberUser(user: CachedUser) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify(user))
  } catch {
    // Storage unavailable — offline start just won't work in this browser.
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
