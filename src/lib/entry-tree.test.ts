import { describe, it, expect } from 'vitest'
import type { EntryRow } from '@/types/database'
import {
  getNextSortOrder,
  collectDescendantIds,
  filterTopLevelIds,
  isDuplicateName,
  deduplicateName,
} from './entry-tree'

function row(overrides: Partial<EntryRow> & Pick<EntryRow, 'id' | 'name' | 'parent_id'>): EntryRow {
  return {
    user_id: 'u1',
    kind: 'document',
    document_type: 'md',
    storage_path: null,
    content: '',
    metadata: null,
    sort_order: 1000,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

// root/
//   folderA/
//     folderB/
//       doc3.md
//     doc2.md
//   folderC/
//   doc1.md
//   doc4.md
const folderA = row({
  id: 'folderA',
  name: 'folderA',
  parent_id: null,
  kind: 'directory',
  document_type: null,
})
const folderB = row({
  id: 'folderB',
  name: 'folderB',
  parent_id: 'folderA',
  kind: 'directory',
  document_type: null,
})
const folderC = row({
  id: 'folderC',
  name: 'folderC',
  parent_id: null,
  kind: 'directory',
  document_type: null,
})
const doc1 = row({ id: 'doc1', name: 'doc1.md', parent_id: null })
const doc2 = row({ id: 'doc2', name: 'doc2.md', parent_id: 'folderA' })
const doc3 = row({ id: 'doc3', name: 'doc3.md', parent_id: 'folderB' })
const doc4 = row({ id: 'doc4', name: 'doc4.md', parent_id: null })

const fixture: EntryRow[] = [folderA, folderB, folderC, doc1, doc2, doc3, doc4]

describe('getNextSortOrder', () => {
  it('returns 1000 for an empty parent', () => {
    expect(getNextSortOrder(fixture, 'folderC')).toBe(1000)
  })

  it('returns max + 1000 otherwise', () => {
    const entries = [
      row({ id: 'a', name: 'a', parent_id: null, sort_order: 500 }),
      row({ id: 'b', name: 'b', parent_id: null, sort_order: 2000 }),
    ]
    expect(getNextSortOrder(entries, null)).toBe(3000)
  })
})

describe('collectDescendantIds', () => {
  it('returns self + all transitive children, depth-first', () => {
    expect(collectDescendantIds(fixture, 'folderA')).toEqual(['folderA', 'folderB', 'doc3', 'doc2'])
  })

  it('returns just self for a leaf', () => {
    expect(collectDescendantIds(fixture, 'doc1')).toEqual(['doc1'])
  })
})

describe('filterTopLevelIds', () => {
  it('filters out a child of a selected folder', () => {
    const byId = new Map(fixture.map((e) => [e.id, e]))
    expect(filterTopLevelIds(byId, ['folderA', 'doc2'])).toEqual(['folderA'])
  })

  it('keeps independent entries', () => {
    const byId = new Map(fixture.map((e) => [e.id, e]))
    const result = filterTopLevelIds(byId, ['folderC', 'doc1'])
    expect(new Set(result)).toEqual(new Set(['folderC', 'doc1']))
  })
})

describe('isDuplicateName', () => {
  it('detects a sibling collision', () => {
    expect(isDuplicateName(fixture, 'doc1.md', null)).toBe(true)
  })

  it('excludeId prevents self-collision on rename', () => {
    expect(isDuplicateName(fixture, 'doc1.md', null, 'doc1')).toBe(false)
  })

  it('returns false for a non-colliding name', () => {
    expect(isDuplicateName(fixture, 'new-name.md', null)).toBe(false)
  })
})

describe('deduplicateName', () => {
  it('a.md with existing a.md becomes a (2).md', () => {
    const entries = [row({ id: 'x', name: 'a.md', parent_id: null })]
    expect(deduplicateName(entries, 'a.md', null)).toBe('a (2).md')
  })

  it('increments past an existing (2)', () => {
    const entries = [
      row({ id: 'x', name: 'a.md', parent_id: null }),
      row({ id: 'y', name: 'a (2).md', parent_id: null }),
    ]
    expect(deduplicateName(entries, 'a.md', null)).toBe('a (3).md')
  })

  it('returns the name unchanged when there is no collision', () => {
    expect(deduplicateName(fixture, 'unique.md', null)).toBe('unique.md')
  })
})
