// Unit tests for the trigram index library.
import { describe, it, expect } from 'vitest'
import {
  extractTrigrams,
  buildTrigramIndex,
  removeFileFromIndex,
  updateTrigramsForFile,
  findLiteralCandidates,
  extractLiteralRuns,
  splitOnTopLevelPipe,
  findRegexCandidates,
} from './trigram'

describe('extractTrigrams', () => {
  it('returns all 3-char substrings lowercased', () => {
    expect(extractTrigrams('ABCD')).toEqual(new Set(['abc', 'bcd']))
  })

  it('returns empty set for strings shorter than 3 chars', () => {
    expect(extractTrigrams('ab')).toEqual(new Set())
    expect(extractTrigrams('')).toEqual(new Set())
  })

  it('deduplicates repeated trigrams', () => {
    expect(extractTrigrams('aaaa')).toEqual(new Set(['aaa']))
  })
})

describe('buildTrigramIndex', () => {
  it('maps a shared trigram to both file IDs', () => {
    const contentMap = new Map([
      ['f1', 'foobar'],
      ['f2', 'foobaz'],
    ])
    const index = buildTrigramIndex(contentMap)
    expect(index.get('foo')).toEqual(new Set(['f1', 'f2']))
  })
})

describe('removeFileFromIndex', () => {
  it('removes the file ID from all sets and prunes empty trigrams', () => {
    const index = buildTrigramIndex(
      new Map([
        ['f1', 'foo'],
        ['f2', 'foobar'],
      ]),
    )
    removeFileFromIndex(index, 'f1')
    expect(index.get('foo')).toEqual(new Set(['f2']))

    removeFileFromIndex(index, 'f2')
    expect(index.has('foo')).toBe(false)
    expect(index.has('oob')).toBe(false)
  })
})

describe('updateTrigramsForFile', () => {
  it('removes old trigrams for the file and adds new ones', () => {
    const index = buildTrigramIndex(new Map([['f1', 'foobar']]))
    updateTrigramsForFile(index, 'f1', 'hello')
    expect(index.has('foo')).toBe(false)
    expect(index.get('hel')).toEqual(new Set(['f1']))
  })
})

describe('findLiteralCandidates', () => {
  it('returns null for queries under 3 chars', () => {
    expect(findLiteralCandidates(new Map(), 'ab')).toBeNull()
  })

  it('returns the intersection of file sets for multi-trigram queries', () => {
    const index = buildTrigramIndex(
      new Map([
        ['f1', 'foobar'],
        ['f2', 'foobaz'],
        ['f3', 'foo'],
      ]),
    )
    expect(findLiteralCandidates(index, 'fooba')).toEqual(new Set(['f1', 'f2']))
  })

  it('returns an empty set when any trigram is missing from the index', () => {
    const index = buildTrigramIndex(new Map([['f1', 'foobar']]))
    expect(findLiteralCandidates(index, 'xyzzy')).toEqual(new Set())
  })
})

describe('extractLiteralRuns', () => {
  it('treats a plain string as a single run', () => {
    expect(extractLiteralRuns('foobar')).toEqual(['foobar'])
  })

  it('splits on metacharacters, keeping runs of length >= 3', () => {
    expect(extractLiteralRuns('foo.*bar')).toEqual(['foo', 'bar'])
  })

  it('drops runs shorter than 3 chars', () => {
    expect(extractLiteralRuns('ab.*cd')).toEqual([])
  })

  it('treats escaped metacharacters as literals', () => {
    expect(extractLiteralRuns('foo\\.bar')).toEqual(['foo.bar'])
  })

  it('breaks runs on character classes', () => {
    expect(extractLiteralRuns('abc[xyz]def')).toEqual(['abc', 'def'])
  })
})

describe('splitOnTopLevelPipe', () => {
  it('splits on a top-level pipe', () => {
    expect(splitOnTopLevelPipe('abc|def')).toEqual(['abc', 'def'])
  })

  it('does not split a pipe inside a group', () => {
    expect(splitOnTopLevelPipe('a(b|c)d')).toEqual(['a(b|c)d'])
  })

  it('does not split an escaped pipe', () => {
    expect(splitOnTopLevelPipe('a\\|b')).toEqual(['a\\|b'])
  })
})

describe('findRegexCandidates', () => {
  it('returns null when a branch has no literal runs', () => {
    const index = buildTrigramIndex(new Map([['f1', 'foobar']]))
    expect(findRegexCandidates(index, 'a.*')).toBeNull()
  })

  it('returns the union of candidates across alternation branches', () => {
    const index = buildTrigramIndex(
      new Map([
        ['f1', 'foobar'],
        ['f2', 'bazqux'],
        ['f3', 'nothing here'],
      ]),
    )
    expect(findRegexCandidates(index, 'foobar|bazqux')).toEqual(new Set(['f1', 'f2']))
  })
})
