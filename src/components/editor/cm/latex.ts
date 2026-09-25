// LaTeX math support for the markdown editor: a @lezer/markdown extension that parses `$…$`,
// `$$…$$` and fenced `$$` blocks (mirroring the preview's marked-katex-extension rules) and
// tokenizes the LaTeX inside them, plus the editor-side highlighter and block background.
import type { BlockContext, Element, InlineContext, Line, MarkdownConfig } from '@lezer/markdown'
import { Tag, tagHighlighter } from '@lezer/highlight'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * marked-katex-extension's standard (non-`nonStandard`) inline rule: `$…$` or `$$…$$` on one
 * line, non-empty, backslash escapes skip the next char, and the closer must be followed by
 * whitespace, `?!.,:` (or their full-width forms) or the end of the inline text.
 *
 * Deviation: the closer may also be followed by `*`, `_`, `~` or `]`. In marked, math wrapped in
 * emphasis/strikethrough/link text (`**$x$**`, `[$x$](url)`) is lexed recursively on the inner
 * text, where the closer sits at the end of the string — so the preview renders it as math.
 */
const INLINE_MATH =
  /^(\$\$?)(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:？！。，：*_~\]]|$)/

/**
 * Characters that may precede an inline `$` opener. marked-katex only cuts a text run at a `$`
 * preceded by a space (or at a token boundary). Line starts are token boundaries because the
 * preview uses `breaks: true`; emphasis/strike/link openers are boundaries because their
 * content is lexed recursively. Tabs and other characters (`a$x$`, `($x$)`) are not.
 */
const INLINE_OPENER_PREV = new Set([' ', '\n', '*', '_', '~', '['])

/**
 * Match inline math at the start of `text` (which must begin with `$` and should extend at least
 * to the end of the current line). `prev` is the character before the `$`, or `null` at the
 * start of an inline section. Returns the delimiter length and total match length, or null.
 */
export function matchInlineMath(
  text: string,
  prev: string | null,
): { markLen: number; length: number } | null {
  if (prev !== null && !INLINE_OPENER_PREV.has(prev)) return null
  const m = INLINE_MATH.exec(text)
  if (!m) return null
  return { markLen: m[1]!.length, length: m[0].length }
}

/**
 * One-line display math (`$$x$$` alone on its line) — the `blockKatexBreak` rule in
 * src/lib/markdown.ts, restricted to a single line.
 */
const SINGLE_LINE_BLOCK = /^\$\$(?!\n)((?:\\[^]|[^\\])+?)\$\$$/

export type BlockMathOpen = { kind: 'fenced'; fence: '$' | '$$' } | { kind: 'single' } | null

/**
 * Classify a line (with container markers/indent already stripped) as a block-math opener.
 * - `$$` or `$` exactly → fenced block closed by the same fence alone on a line (marked-katex's
 *   `blockRule`; `$` blocks render in inline style but are still block-level math).
 * - `$$…$$` exactly → one-line display block (`blockKatexBreak`).
 *
 * Deviation: `$$a` … `b$$` spanning lines without fence lines is not recognised (it would need
 * unbounded lookahead, which breaks incremental parsing); it's rare and still renders in the
 * preview. An unclosed fence runs to the end of its container, like fenced code.
 */
export function classifyBlockMathLine(text: string): BlockMathOpen {
  if (text === '$$' || text === '$') return { kind: 'fenced', fence: text }
  if (SINGLE_LINE_BLOCK.test(text)) return { kind: 'single' }
  return null
}

/**
 * Lines that end a paragraph in the preview (`blockKatexBreak.start`: `\n$$` or `\n$\n`).
 * A line starting with `$$` always begins a new block, even when it isn't math.
 */
export function interruptsParagraph(text: string): boolean {
  return text.startsWith('$$') || text === '$'
}

export type LatexTokenType =
  | 'MathCommand'
  | 'MathEnvName'
  | 'MathBrace'
  | 'MathScript'
  | 'MathAlign'
  | 'MathComment'
  | 'MathNumber'

export interface LatexToken {
  type: LatexTokenType
  from: number
  to: number
}

const isLetter = (c: string | undefined) => !!c && /[a-zA-Z]/.test(c)
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9'

/**
 * Split LaTeX source into highlightable tokens. Positions are `offset`-relative. Plain letters,
 * operators and brackets are left untokenized (they render in the base text colour).
 */
export function tokenizeLatex(text: string, offset = 0): LatexToken[] {
  const out: LatexToken[] = []
  const push = (type: LatexTokenType, from: number, to: number) =>
    out.push({ type, from: from + offset, to: to + offset })
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]!
    if (c === '\\') {
      const d = text[i + 1]
      if (d === undefined) {
        i++
      } else if (d === '\\') {
        push('MathAlign', i, i + 2)
        i += 2
      } else if (isLetter(d)) {
        let j = i + 1
        while (isLetter(text[j])) j++
        if (text[j] === '*') j++
        push('MathCommand', i, j)
        const name = text.slice(i + 1, j)
        i = j
        if (name === 'begin' || name === 'end') {
          // `\begin{align*}` — highlight the environment name distinctly.
          let k = j
          while (text[k] === ' ') k++
          const m = /^\{([a-zA-Z]+\*?)\}/.exec(text.slice(k))
          if (m) {
            push('MathBrace', k, k + 1)
            push('MathEnvName', k + 1, k + 1 + m[1]!.length)
            push('MathBrace', k + 1 + m[1]!.length, k + m[0].length)
            i = k + m[0].length
          }
        }
      } else {
        // Control symbol: `\,`, `\{`, `\%`, `\$`, …
        push('MathCommand', i, i + 2)
        i += 2
      }
    } else if (c === '{' || c === '}') {
      push('MathBrace', i, i + 1)
      i++
    } else if (c === '^' || c === '_') {
      push('MathScript', i, i + 1)
      i++
    } else if (c === '&') {
      push('MathAlign', i, i + 1)
      i++
    } else if (c === '%') {
      let j = text.indexOf('\n', i)
      if (j < 0) j = n
      push('MathComment', i, j)
      i = j
    } else if (isDigit(c)) {
      let j = i + 1
      while (isDigit(text[j])) j++
      if (text[j] === '.' && isDigit(text[j + 1])) {
        j++
        while (isDigit(text[j])) j++
      }
      push('MathNumber', i, j)
      i = j
    } else {
      i++
    }
  }
  return out
}

/** Highlight tags for math nodes (no parents, so other highlight styles ignore them). */
export const latexTags = {
  mark: Tag.define('mathMark'),
  command: Tag.define('mathCommand'),
  envName: Tag.define('mathEnvName'),
  brace: Tag.define('mathBrace'),
  script: Tag.define('mathScript'),
  align: Tag.define('mathAlign'),
  comment: Tag.define('mathComment'),
  number: Tag.define('mathNumber'),
}

const DOLLAR = 36

/** Lezer's `Line` keeps these public-in-practice fields off its type declarations. */
interface LineInternals {
  depth: number
  markers: Element[]
}

function latexElements(cx: BlockContext | InlineContext, text: string, offset: number): Element[] {
  return tokenizeLatex(text, offset).map((t) => cx.elt(t.type, t.from, t.to))
}

/** Container-stripped text of a block line, or null if it's indented past the base indent. */
function baseText(line: Line): string | null {
  return line.pos === line.basePos ? line.text.slice(line.pos) : null
}

function parseBlockMath(cx: BlockContext, line: Line): boolean {
  if (line.next !== DOLLAR) return false
  const text = baseText(line)
  if (text === null) return false
  const open = classifyBlockMathLine(text)
  if (!open) return false

  const from = cx.lineStart + line.pos
  if (open.kind === 'single') {
    const to = cx.lineStart + line.text.length
    const children = [
      cx.elt('MathMark', from, from + 2),
      ...latexElements(cx, text.slice(2, -2), from + 2),
      cx.elt('MathMark', to - 2, to),
    ]
    cx.nextLine()
    cx.addElement(cx.elt('BlockMath', from, to, children))
    return true
  }

  const children: Element[] = [cx.elt('MathMark', from, from + open.fence.length)]
  const depth = cx.depth
  const internals = line as unknown as LineInternals
  // Same loop shape as @lezer/markdown's FencedCode: stop when the enclosing container ends.
  while (cx.nextLine() && internals.depth >= depth) {
    children.push(...internals.markers)
    const lineFrom = cx.lineStart + line.basePos
    if (baseText(line) === open.fence) {
      children.push(cx.elt('MathMark', lineFrom, lineFrom + open.fence.length))
      cx.nextLine()
      break
    }
    children.push(...latexElements(cx, line.text.slice(line.basePos), lineFrom))
  }
  cx.addElement(cx.elt('BlockMath', from, cx.prevLineEnd(), children))
  return true
}

function parseInlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1
  const prev = pos > cx.offset ? String.fromCharCode(cx.char(pos - 1)) : null
  let lineEnd = pos
  while (lineEnd < cx.end && cx.char(lineEnd) !== 10) lineEnd++
  const text = cx.slice(pos, lineEnd)
  const m = matchInlineMath(text, prev)
  if (!m) return -1
  const end = pos + m.length
  const inner = pos + m.markLen
  const close = end - m.markLen
  return cx.addElement(
    cx.elt('InlineMath', pos, end, [
      cx.elt('MathMark', pos, inner),
      ...latexElements(cx, cx.slice(inner, close), inner),
      cx.elt('MathMark', close, end),
    ]),
  )
}

export const latexMath: MarkdownConfig = {
  defineNodes: [
    { name: 'BlockMath', block: true },
    { name: 'InlineMath' },
    { name: 'MathMark', style: latexTags.mark },
    { name: 'MathCommand', style: latexTags.command },
    { name: 'MathEnvName', style: latexTags.envName },
    { name: 'MathBrace', style: latexTags.brace },
    { name: 'MathScript', style: latexTags.script },
    { name: 'MathAlign', style: latexTags.align },
    { name: 'MathComment', style: latexTags.comment },
    { name: 'MathNumber', style: latexTags.number },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      before: 'LinkReference',
      parse: parseBlockMath,
      endLeaf: (_cx, line) => {
        const text = baseText(line)
        return text !== null && interruptsParagraph(text)
      },
    },
  ],
  parseInline: [{ name: 'InlineMath', parse: parseInlineMath }],
}

/** Maps math tags to `cm-math-*` classes; colours live in `lilypadTheme` (cm/theme.ts). */
const latexHighlighter = tagHighlighter([
  { tag: latexTags.mark, class: 'cm-math-mark' },
  { tag: latexTags.command, class: 'cm-math-command' },
  { tag: latexTags.envName, class: 'cm-math-env' },
  { tag: latexTags.brace, class: 'cm-math-brace' },
  { tag: latexTags.script, class: 'cm-math-script' },
  { tag: latexTags.align, class: 'cm-math-align' },
  { tag: latexTags.comment, class: 'cm-math-comment' },
  { tag: latexTags.number, class: 'cm-math-number' },
])

const blockLine = Decoration.line({ class: 'cm-math-block' })

function blockMathDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const tree = syntaxTree(view.state)
  let lastLine = -1
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== 'BlockMath') return
        const start = Math.max(node.from, from)
        const end = Math.min(node.to, to)
        for (let pos = start; pos <= end; ) {
          const line = view.state.doc.lineAt(pos)
          if (line.from > lastLine) {
            ranges.push(blockLine.range(line.from))
            lastLine = line.from
          }
          pos = line.to + 1
        }
        return false
      },
    })
  }
  return Decoration.set(ranges)
}

const blockMathBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = blockMathDecorations(view)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = blockMathDecorations(update.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

export const latexEditorExtensions: Extension = [
  syntaxHighlighting(latexHighlighter),
  blockMathBackground,
]
