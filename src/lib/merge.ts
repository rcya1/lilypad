// Git-style three-way merge for note text, and helpers for the conflict blocks it leaves.
import { diff3Merge } from 'node-diff3'

/** Labels after `<<<<<<<` / `>>>>>>>`. */
export const MINE_LABEL = 'This device'
export const THEIRS_LABEL = 'Server'

const START = '<<<<<<<'
const SEPARATOR = '======='
const END = '>>>>>>>'

export interface MergeResult {
  text: string
  /** Conflict blocks left in `text` (0 = clean). */
  conflicts: number
}

/** Line-based. Overlapping edits become conflict blocks, mine first. */
export function threeWayMerge(base: string, mine: string, theirs: string): MergeResult {
  if (mine === theirs || theirs === base) return { text: mine, conflicts: 0 }
  if (mine === base) return { text: theirs, conflicts: 0 }

  const lines: string[] = []
  let conflicts = 0
  for (const region of diff3Merge(mine.split('\n'), base.split('\n'), theirs.split('\n'))) {
    if (region.ok) {
      lines.push(...region.ok)
    } else if (region.conflict) {
      conflicts++
      lines.push(
        `${START} ${MINE_LABEL}`,
        ...region.conflict.a,
        SEPARATOR,
        ...region.conflict.b,
        `${END} ${THEIRS_LABEL}`,
      )
    }
  }
  return { text: lines.join('\n'), conflicts }
}

export interface ConflictBlock {
  from: number
  /** Just past the `>>>>>>>` line, excluding its newline. */
  to: number
  /** Marker line starts, for decorating them. */
  startLine: number
  separatorLine: number
  endLine: number
  mine: string
  theirs: string
}

/** Well-formed blocks only. */
export function findConflicts(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  const lines = text.split('\n')
  let offset = 0
  let open: {
    from: number
    mine: string[]
    theirs: string[]
    separatorLine: number | null
  } | null = null

  for (const line of lines) {
    if (line.startsWith(START)) {
      open = { from: offset, mine: [], theirs: [], separatorLine: null }
    } else if (open && open.separatorLine === null && line === SEPARATOR) {
      open.separatorLine = offset
    } else if (open && open.separatorLine !== null && line.startsWith(END)) {
      blocks.push({
        from: open.from,
        to: offset + line.length,
        startLine: open.from,
        separatorLine: open.separatorLine,
        endLine: offset,
        mine: open.mine.join('\n'),
        theirs: open.theirs.join('\n'),
      })
      open = null
    } else if (open) {
      ;(open.separatorLine === null ? open.mine : open.theirs).push(line)
    }
    offset += line.length + 1
  }
  return blocks
}

export function hasConflicts(text: string): boolean {
  return findConflicts(text).length > 0
}

export type ConflictChoice = 'mine' | 'theirs' | 'both'

/** If the chosen side is empty, its line break goes too, so no blank line is left. */
export function resolveConflict(
  text: string,
  block: ConflictBlock,
  choice: ConflictChoice,
): { from: number; to: number; insert: string } {
  const parts =
    choice === 'mine'
      ? [block.mine]
      : choice === 'theirs'
        ? [block.theirs]
        : [block.mine, block.theirs]
  const kept = parts.filter((p) => p !== '')
  const insert = kept.join('\n')
  if (insert !== '') return { from: block.from, to: block.to, insert }
  // Nothing kept: swallow the following newline (or the preceding one at the end of the text).
  if (text[block.to] === '\n') return { from: block.from, to: block.to + 1, insert: '' }
  if (block.from > 0) return { from: block.from - 1, to: block.to, insert: '' }
  return { from: block.from, to: block.to, insert: '' }
}
