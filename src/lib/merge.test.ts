import { describe, it, expect } from 'vitest'
import { threeWayMerge, findConflicts, hasConflicts, resolveConflict } from './merge'

const apply = (text: string, e: { from: number; to: number; insert: string }) =>
  text.slice(0, e.from) + e.insert + text.slice(e.to)

describe('threeWayMerge', () => {
  it('takes whichever side changed when only one did', () => {
    expect(threeWayMerge('a\nb', 'a\nB', 'a\nb')).toEqual({ text: 'a\nB', conflicts: 0 })
    expect(threeWayMerge('a\nb', 'a\nb', 'A\nb')).toEqual({ text: 'A\nb', conflicts: 0 })
  })

  it('treats identical edits as no conflict', () => {
    expect(threeWayMerge('a', 'x', 'x')).toEqual({ text: 'x', conflicts: 0 })
  })

  it('merges edits to different lines cleanly', () => {
    const base = 'one\ntwo\nthree\nfour'
    const mine = 'ONE\ntwo\nthree\nfour'
    const theirs = 'one\ntwo\nthree\nFOUR'
    expect(threeWayMerge(base, mine, theirs)).toEqual({
      text: 'ONE\ntwo\nthree\nFOUR',
      conflicts: 0,
    })
  })

  it('merges an insertion on one side with an edit on the other', () => {
    const base = '# Title\n\nbody'
    const mine = '# Title\n\nintro\n\nbody'
    const theirs = '# New title\n\nbody'
    expect(threeWayMerge(base, mine, theirs).text).toBe('# New title\n\nintro\n\nbody')
  })

  it('marks overlapping edits as a conflict, mine first', () => {
    const r = threeWayMerge('a\nb\nc', 'a\nmine\nc', 'a\ntheirs\nc')
    expect(r.conflicts).toBe(1)
    expect(r.text).toBe('a\n<<<<<<< This device\nmine\n=======\ntheirs\n>>>>>>> Server\nc')
  })
})

describe('findConflicts / resolveConflict', () => {
  const text = 'a\n<<<<<<< This device\nmine\n=======\ntheirs\n>>>>>>> Server\nc'

  it('finds blocks with their contents', () => {
    const [block] = findConflicts(text)
    expect(block).toMatchObject({ mine: 'mine', theirs: 'theirs' })
    expect(text.slice(block!.from, block!.to)).toBe(
      '<<<<<<< This device\nmine\n=======\ntheirs\n>>>>>>> Server',
    )
    expect(hasConflicts(text)).toBe(true)
    expect(hasConflicts('a\n=======\nb')).toBe(false)
  })

  it('resolves to mine, theirs or both', () => {
    const [block] = findConflicts(text)
    expect(apply(text, resolveConflict(text, block!, 'mine'))).toBe('a\nmine\nc')
    expect(apply(text, resolveConflict(text, block!, 'theirs'))).toBe('a\ntheirs\nc')
    expect(apply(text, resolveConflict(text, block!, 'both'))).toBe('a\nmine\ntheirs\nc')
  })

  it('removes the line entirely when the chosen side is empty', () => {
    const t = 'a\n<<<<<<< This device\n=======\ntheirs\n>>>>>>> Server\nc'
    const [block] = findConflicts(t)
    expect(apply(t, resolveConflict(t, block!, 'mine'))).toBe('a\nc')
  })

  it('handles several blocks and multi-line sides', () => {
    const t = [
      '<<<<<<< This device',
      'm1',
      'm2',
      '=======',
      't1',
      '>>>>>>> Server',
      'mid',
      '<<<<<<< This device',
      'x',
      '=======',
      'y',
      '>>>>>>> Server',
    ].join('\n')
    const blocks = findConflicts(t)
    expect(blocks.map((b) => [b.mine, b.theirs])).toEqual([
      ['m1\nm2', 't1'],
      ['x', 'y'],
    ])
  })
})
