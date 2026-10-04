// Pinia store for offline sync: the queue of changes not yet on the server, merge bases, and notes
// with unresolved conflicts. Note text is pushed with a compare-and-swap against the version this
// device last saw (docs/features/offline-sync.md). On a mismatch the edits are three-way merged;
// overlapping edits leave conflict markers, and the note stays local until they're resolved.
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'
import { threeWayMerge, hasConflicts } from '@/lib/merge'
import {
  enqueueOp,
  opTarget,
  loadQueue,
  saveQueue,
  loadConflicts,
  saveConflicts,
  type EntryFieldUpdate,
  type NoteBase,
  type SyncOp,
} from '@/lib/offline'
import type { EntryRow } from '@/types/database'
import { hasNoteContent } from '@/types/file-explorer'
import { useAuthStore } from './auth'
import { useToastStore } from './toast'
import { useFilesStore } from './files'

// Retry interval while the browser claims to be online but requests fail.
const RETRY_MS = 30_000

/** No connection, as opposed to the server rejecting the request. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)
  return /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(
    message,
  )
}

interface DbError {
  code?: string
  message?: string
}

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'
const isMissingFunction = (e: DbError) => e.code === 'PGRST202' || e.code === '42883'

export type SyncStatus = 'offline' | 'syncing' | 'conflict' | 'pending' | 'synced'

export const useSyncStore = defineStore('sync', () => {
  const auth = useAuthStore()
  const toast = useToastStore()

  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const queue = ref<SyncOp[]>([])
  const syncing = ref(false)
  const conflictIds = ref(new Set<string>())

  // Server text of each note as last seen: the merge base. Not reactive (it's every note's text).
  const bases = new Map<string, NoteBase>()
  // Whether save_entry_content is deployed: null until tried; false falls back to plain overwrites.
  let casAvailable: boolean | null = null
  let userId: string | null = null
  // New ops are never folded into the one being sent.
  let inFlight: SyncOp | null = null
  let retryTimer = 0
  let listening = false

  const status = computed<SyncStatus>(() => {
    if (!online.value) return 'offline'
    if (conflictIds.value.size > 0) return 'conflict'
    if (syncing.value) return 'syncing'
    if (queue.value.length > 0) return 'pending'
    return 'synced'
  })

  /** Idempotent per user. */
  async function init(uid: string) {
    if (!listening) {
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      listening = true
    }
    if (userId === uid) return
    userId = uid
    queue.value = await loadQueue(uid)
    conflictIds.value = new Set(await loadConflicts(uid))
  }

  function onOnline() {
    online.value = true
    // Push what piled up, then pull whatever changed elsewhere meanwhile.
    void flush().then(() => useFilesStore().refreshFromServer())
  }

  function onOffline() {
    online.value = false
  }

  function getBase(id: string): NoteBase | undefined {
    return bases.get(id)
  }
  function setBase(id: string, base: NoteBase) {
    bases.set(id, base)
  }
  function deleteBase(id: string) {
    bases.delete(id)
  }
  function exportBases(): Record<string, NoteBase> {
    return Object.fromEntries(bases)
  }
  function importBases(record: Record<string, NoteBase>) {
    bases.clear()
    for (const [id, base] of Object.entries(record)) bases.set(id, base)
  }

  function persistQueue() {
    // JSON round-trip strips Vue's reactive proxies, which IndexedDB can't clone.
    if (userId) void saveQueue(userId, JSON.parse(JSON.stringify(queue.value)))
  }

  /** Also tries to send it straight away. */
  function enqueue(op: SyncOp) {
    const [head, ...rest] = queue.value
    queue.value =
      inFlight && head === inFlight ? [head, ...enqueueOp(rest, op)] : enqueueOp(queue.value, op)
    persistQueue()
    void flush()
  }

  /** e.g. for everything inside a folder deleted locally. */
  function dropOpsFor(ids: string[]) {
    const drop = new Set(ids)
    queue.value = queue.value.filter((op) => op === inFlight || !drop.has(opTarget(op)))
    persistQueue()
  }

  function hasPending(id: string, kind?: SyncOp['kind']): boolean {
    return queue.value.some((op) => opTarget(op) === id && (!kind || op.kind === kind))
  }

  function setConflict(id: string, conflicted: boolean) {
    const next = new Set(conflictIds.value)
    if (conflicted) next.add(id)
    else next.delete(id)
    conflictIds.value = next
    if (userId) void saveConflicts(userId, [...next])
  }

  /** A conflicted note stays local while it still has conflict markers. */
  function noteChanged(id: string, content: string) {
    if (conflictIds.value.has(id)) {
      if (hasConflicts(content)) return
      setConflict(id, false)
    }
    enqueue({ kind: 'content', id })
  }

  function scheduleRetry() {
    if (retryTimer) return
    retryTimer = window.setTimeout(() => {
      retryTimer = 0
      void flush()
    }, RETRY_MS)
  }

  /** In order; stops at the first connection failure, keeping the rest. */
  async function flush(): Promise<void> {
    if (syncing.value || !auth.user || queue.value.length === 0) return
    if (!navigator.onLine) {
      online.value = false
      return
    }
    syncing.value = true
    try {
      while (queue.value.length > 0) {
        const op = queue.value[0]!
        inFlight = op
        try {
          await runOp(op)
        } catch (err) {
          if (isNetworkError(err)) {
            if (!navigator.onLine) online.value = false
            scheduleRetry()
            return
          }
          // The server rejected it: retrying won't help, so drop it rather than block the queue.
          console.error('sync: dropping a change the server rejected', op, err)
          toast.addToast(`Couldn't sync a change${describe(op)}.`, 'error')
        } finally {
          inFlight = null
        }
        queue.value = queue.value.filter((o) => o !== op)
        persistQueue()
      }
      online.value = true
    } finally {
      syncing.value = false
    }
  }

  function describe(op: SyncOp): string {
    const id = opTarget(op)
    const name = useFilesStore().getEntry(id)?.name
    return name ? ` to "${name.replace(/\.md$/, '')}"` : ''
  }

  async function runOp(op: SyncOp): Promise<void> {
    switch (op.kind) {
      case 'create':
        return insertEntry(op.row.id)
      case 'update':
        return runUpdate(op.id, op.fields)
      case 'delete':
        return runDelete(op.id, op.storagePaths)
      case 'content':
        return pushContent(op.id)
      case 'hl-create': {
        const { error } = await supabase.from('annotations').insert(op.row)
        // Already there (a retried create), or its web page is gone: nothing more to do.
        if (error && error.code !== UNIQUE_VIOLATION && error.code !== FOREIGN_KEY_VIOLATION)
          throw error
        return
      }
      case 'hl-update': {
        const { error } = await supabase.from('annotations').update(op.fields).eq('id', op.id)
        if (error) throw error
        return
      }
      case 'hl-delete': {
        const { error } = await supabase.from('annotations').delete().eq('id', op.id)
        if (error) throw error
        return
      }
    }
  }

  /**
   * Inserts the entry as it is locally (a queued create, or restoring a note deleted elsewhere).
   * Falls back to the top level if its folder is gone.
   */
  async function insertEntry(id: string, contentOverride?: string): Promise<void> {
    const files = useFilesStore()
    const row = files.getEntry(id)
    if (!row) return // deleted locally since
    const isText = hasNoteContent(row.document_type)
    const content = isText ? (contentOverride ?? files.getCached(id) ?? '') : row.content
    let parentId = row.parent_id

    for (;;) {
      const { data, error } = await supabase
        .from('entries')
        .insert({
          id: row.id,
          user_id: row.user_id,
          kind: row.kind,
          name: row.name,
          document_type: row.document_type,
          parent_id: parentId,
          storage_path: row.storage_path,
          content,
          metadata: row.metadata,
          sort_order: row.sort_order,
        })
        .select()
        .returns<EntryRow[]>()
        .maybeSingle()
      if (error?.code === FOREIGN_KEY_VIOLATION && parentId !== null) {
        parentId = null
        files.patchEntry(id, { parent_id: null })
        continue
      }
      if (error?.code === UNIQUE_VIOLATION) return // already created (a retried request)
      if (error) throw error
      if (isText) bases.set(id, { version: data?.version ?? null, content: content ?? '' })
      return
    }
  }

  async function runUpdate(id: string, fields: EntryFieldUpdate) {
    const { error } = await supabase.from('entries').update(fields).eq('id', id)
    // Renaming or moving something deleted elsewhere is a no-op (the update matches no rows).
    if (error) throw error
  }

  async function runDelete(id: string, storagePaths: string[]) {
    const { error } = await supabase.from('entries').delete().eq('id', id)
    if (error) throw error
    if (storagePaths.length > 0) {
      const { error: storageErr } = await supabase.storage.from('user-files').remove(storagePaths)
      // The rows are gone; an orphaned blob is harmless.
      if (storageErr) console.error('sync: failed to remove storage blobs', storageErr)
    }
  }

  /**
   * Compare-and-swap against the version the text was based on. On a mismatch the server's text is
   * merged in and the result pushed, or left with conflict markers if the edits overlap.
   */
  async function pushContent(id: string): Promise<void> {
    const files = useFilesStore()
    // A clean merge, or a version bump from a rename, each need another round.
    for (let round = 0; round < 4; round++) {
      const local = files.getCached(id)
      if (local === undefined || !files.getEntry(id)) return // deleted locally
      if (conflictIds.value.has(id)) return // resolved in the editor first
      const base = bases.get(id)

      if (casAvailable !== false && base?.version != null) {
        const { data, error } = await supabase.rpc('save_entry_content', {
          p_id: id,
          p_content: local,
          p_expected_version: base.version,
        })
        if (error && isMissingFunction(error)) {
          casAvailable = false
          console.warn('sync: save_entry_content is not deployed; falling back to overwrites')
          continue
        }
        if (error) throw error
        casAvailable = true
        const result = data?.[0]
        if (!result) throw new Error('save_entry_content returned no row')

        if (result.ok) {
          bases.set(id, { version: result.version, content: local })
          return
        }
        if (result.version == null) return restoreDeleted(id, local)

        const theirs = result.content ?? ''
        bases.set(id, { version: result.version, content: theirs })
        // Only something other than the text changed (a rename, a move), or both sides already
        // agree: just retry against the new version.
        if (theirs === base.content || theirs === local) continue

        // Merge against the freshest text (the editor may hold typing newer than the last save).
        const latest = files.getLatestText(id) ?? local
        const merged = threeWayMerge(base.content, latest, theirs)
        files.applyMergedContent(id, merged.text)
        if (merged.conflicts > 0) {
          setConflict(id, true)
          const name = files.getEntry(id)?.name.replace(/\.md$/, '') ?? 'a note'
          toast.addToast(
            `"${name}" was also changed on another device. Resolve the conflicts to sync it.`,
            'info',
          )
          return
        }
        continue // push the clean merge
      }

      // No versioning (migration not applied yet): plain overwrite, as before.
      const { data, error } = await supabase
        .from('entries')
        .update({ content: local })
        .eq('id', id)
        .select()
        .returns<EntryRow[]>()
      if (error) throw error
      if (!data?.length) return restoreDeleted(id, local)
      bases.set(id, { version: data[0]!.version ?? null, content: local })
      return
    }
  }

  /** Edited here but deleted elsewhere: the edit wins and the note comes back. */
  async function restoreDeleted(id: string, local: string) {
    const name = useFilesStore().getEntry(id)?.name.replace(/\.md$/, '')
    await insertEntry(id, local)
    toast.addToast(
      `"${name ?? 'A note'}" was deleted on another device. It's been restored with your changes.`,
      'info',
    )
  }

  function $reset() {
    queue.value = []
    conflictIds.value = new Set()
    syncing.value = false
    bases.clear()
    casAvailable = null
    userId = null
    inFlight = null
    clearTimeout(retryTimer)
    retryTimer = 0
  }

  return {
    online,
    queue,
    syncing,
    conflictIds,
    status,
    init,
    getBase,
    setBase,
    deleteBase,
    exportBases,
    importBases,
    enqueue,
    dropOpsFor,
    hasPending,
    setConflict,
    noteChanged,
    flush,
    $reset,
  }
})
