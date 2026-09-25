import { describe, it, expect } from 'vitest'
import { enqueueOp, type SyncOp } from './offline'
import type { EntryRow } from '@/types/database'

const row = (id: string, over: Partial<EntryRow> = {}): EntryRow => ({
  id,
  user_id: 'u',
  kind: 'document',
  name: `${id}.md`,
  document_type: 'md',
  parent_id: null,
  storage_path: null,
  content: '',
  metadata: null,
  sort_order: 1000,
  created_at: '',
  updated_at: '',
  ...over,
})

const run = (...ops: SyncOp[]) => ops.reduce<SyncOp[]>((q, op) => enqueueOp(q, op), [])

describe('enqueueOp', () => {
  it('keeps one content op per note', () => {
    expect(run({ kind: 'content', id: 'a' }, { kind: 'content', id: 'a' })).toEqual([
      { kind: 'content', id: 'a' },
    ])
  })

  it('merges updates field by field, latest wins', () => {
    expect(
      run(
        { kind: 'update', id: 'a', fields: { name: 'x' } },
        { kind: 'update', id: 'a', fields: { sort_order: 2000 } },
        { kind: 'update', id: 'a', fields: { name: 'y' } },
      ),
    ).toEqual([{ kind: 'update', id: 'a', fields: { name: 'y', sort_order: 2000 } }])
  })

  it('folds updates into a pending create', () => {
    const q = run(
      { kind: 'create', row: row('a') },
      { kind: 'update', id: 'a', fields: { name: 'b.md' } },
    )
    expect(q).toHaveLength(1)
    expect(q[0]).toMatchObject({ kind: 'create', row: { id: 'a', name: 'b.md' } })
  })

  it('cancels a create entirely when it is deleted before syncing', () => {
    expect(
      run(
        { kind: 'create', row: row('a') },
        { kind: 'content', id: 'a' },
        { kind: 'delete', id: 'a', storagePaths: [] },
      ),
    ).toEqual([])
  })

  it('drops earlier ops for a target that gets deleted', () => {
    expect(
      run(
        { kind: 'content', id: 'a' },
        { kind: 'update', id: 'a', fields: { name: 'x' } },
        { kind: 'content', id: 'b' },
        { kind: 'delete', id: 'a', storagePaths: [] },
      ),
    ).toEqual([
      { kind: 'content', id: 'b' },
      { kind: 'delete', id: 'a', storagePaths: [] },
    ])
  })
})
