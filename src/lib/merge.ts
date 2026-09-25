// Git-style three-way merge for note text, plus helpers for finding and resolving the conflict
// blocks it leaves behind. Used by the sync engine when a note changed both on this device and on
// the server since they last agreed, and by the editor's conflict UI.
import { diff3Merge } from 'node-diff3'

/** Marker labels, as they appear after `<<<<<<<` / `>>>>>>>` in a conflicted note. */
export const MINE_LABEL = 'This device'
export const THEIRS_LABEL = 'Server'

const START = '<<<<<<<'
const SEPARATOR = '======='
const END = '>>>>>>>'

export interface MergeResult {
  text: string
  /** Number of conflict blocks left in `text` (0 = clean merge). */
  conflicts: number
}

/**
 * Line-based three-way merge. `base` is the version both sides started from; `mine` and
 * `theirs` are the two edits. Changes to different lines merge cleanly; overlapping changes
 * become git-style conflict blocks (mine first, then theirs).
 */
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

/** One conflict block in a note, located by character offsets. */
export interface ConflictBlock {
  /** Offset of the start of the `<<<<<<<` line. */
  from: number
  /** Offset just past the end of the `>>>>>>>` line (excluding its newline). */
  to: number
  /** Offsets of the start of each marker line (for decorating them). */
  startLine: number
  separatorLine: number
  endLine: number
  mine: string
  theirs: string
}

/** Finds every well-formed conflict block (`<<<<<<<` … `=======` … `>>>>>>>`) in `text`. */
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

/**
 * The edit that resolves `block` in `text` with the given choice. When the chosen side is empty,
 * the block's line break is removed too so no blank line is left behind.
 */
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
