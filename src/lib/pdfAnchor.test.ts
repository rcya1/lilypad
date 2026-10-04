import { describe, expect, it } from 'vitest'
import { mergeLineBoxes, normalizeQuote, type Box } from './pdfAnchor'

const box = (left: number, top: number, right: number, bottom: number): Box => ({
  left,
  top,
  right,
  bottom,
})

describe('mergeLineBoxes', () => {
  it('merges adjacent fragments on one line', () => {
    expect(mergeLineBoxes([box(10, 0, 40, 12), box(44, 1, 90, 12), box(0, 0, 9, 12)])).toEqual([
      box(0, 0, 90, 12),
    ])
  })

  it('keeps separate lines apart', () => {
    expect(mergeLineBoxes([box(0, 20, 50, 32), box(0, 0, 50, 12)])).toEqual([
      box(0, 0, 50, 12),
      box(0, 20, 50, 32),
    ])
  })

  it('keeps far-apart columns on the same line apart', () => {
    expect(mergeLineBoxes([box(0, 0, 50, 12), box(300, 0, 350, 12)])).toHaveLength(2)
  })

  it('drops empty boxes', () => {
    expect(mergeLineBoxes([box(5, 5, 5, 20), box(0, 0, 10, 0)])).toEqual([])
  })
})

describe('normalizeQuote', () => {
  it('collapses line breaks and runs of spaces', () => {
    expect(normalizeQuote('  Lemma\n2.1.   Let  x ')).toBe('Lemma 2.1. Let x')
  })
})
