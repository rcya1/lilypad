import { describe, it, expect } from 'vitest'
import { parseMarkdown } from './markdown'

/** Extract all data-source-line values from HTML in order of appearance */
function extractSourceLines(html: string): { tag: string; line: number }[] {
  const results: { tag: string; line: number }[] = []
  const re = /<(\w+)[^>]*\bdata-source-line="(\d+)"[^>]*>/g
  let m
  while ((m = re.exec(html))) {
    results.push({ tag: m[1]!, line: parseInt(m[2]!, 10) })
  }
  return results
}

/** Shorthand: get just the line numbers */
function lines(html: string): number[] {
  return extractSourceLines(html).map((r) => r.line)
}

/** Get source line for a specific tag (first match) */
function lineFor(html: string, tag: string): number | undefined {
  return extractSourceLines(html).find((r) => r.tag === tag)?.line
}

// ---------------------------------------------------------------------------
// Basic block elements
// ---------------------------------------------------------------------------

describe('source line annotation — basic blocks', () => {
  it('annotates headings', () => {
    const html = parseMarkdown('# Hello\n## World\n')
    const sl = extractSourceLines(html)
    expect(sl).toContainEqual({ tag: 'h1', line: 1 })
    expect(sl).toContainEqual({ tag: 'h2', line: 2 })
  })

  it('annotates paragraphs', () => {
    const html = parseMarkdown('first\n\nsecond\n')
    const sl = extractSourceLines(html)
    expect(sl).toContainEqual({ tag: 'p', line: 1 })
    expect(sl).toContainEqual({ tag: 'p', line: 3 })
  })

  it('annotates code blocks', () => {
    const html = parseMarkdown('text\n\n```js\nconst x = 1\n```\n')
    expect(lineFor(html, 'pre')).toBe(3)
  })

  it('annotates blockquotes', () => {
    const html = parseMarkdown('text\n\n> quoted\n')
    expect(lineFor(html, 'blockquote')).toBe(3)
  })

  it('annotates horizontal rules', () => {
    const html = parseMarkdown('above\n\n---\n\nbelow\n')
    expect(lineFor(html, 'hr')).toBe(3)
  })

  it('annotates tables', () => {
    const html = parseMarkdown('text\n\n| a | b |\n| - | - |\n| 1 | 2 |\n')
    expect(lineFor(html, 'table')).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Lists — flat
// ---------------------------------------------------------------------------

describe('source line annotation — flat lists', () => {
  it('annotates ul and each li', () => {
    const html = parseMarkdown('- alpha\n- beta\n- gamma\n')
    const sl = extractSourceLines(html)
    expect(sl).toContainEqual({ tag: 'ul', line: 1 })
    expect(sl).toContainEqual({ tag: 'li', line: 1 })
    expect(sl).toContainEqual({ tag: 'li', line: 2 })
    expect(sl).toContainEqual({ tag: 'li', line: 3 })
  })

  it('annotates ordered lists', () => {
    const html = parseMarkdown('1. first\n2. second\n3. third\n')
    const sl = extractSourceLines(html)
    expect(sl).toContainEqual({ tag: 'ol', line: 1 })
    expect(sl).toContainEqual({ tag: 'li', line: 1 })
    expect(sl).toContainEqual({ tag: 'li', line: 2 })
    expect(sl).toContainEqual({ tag: 'li', line: 3 })
  })
})

// ---------------------------------------------------------------------------
// Lists — nested
// ---------------------------------------------------------------------------

describe('source line annotation — nested lists', () => {
  it('annotates nested list items correctly', () => {
    const html = parseMarkdown('- parent\n  - child 1\n  - child 2\n- sibling\n')
    const sl = extractSourceLines(html)

    // outer list + items
    expect(sl).toContainEqual({ tag: 'ul', line: 1 })
    expect(sl).toContainEqual({ tag: 'li', line: 1 }) // parent
    expect(sl).toContainEqual({ tag: 'li', line: 4 }) // sibling

    // nested list items
    const liLines = sl.filter((r) => r.tag === 'li').map((r) => r.line)
    expect(liLines).toContain(2) // child 1
    expect(liLines).toContain(3) // child 2
  })

  it('handles nested list with blank lines (loose list)', () => {
    // This is the exact case from the bug report
    const html = parseMarkdown('# asd\n- asdlkjasd\n  - asd\n \n  - asd\n\n\n')
    const sl = extractSourceLines(html)

    expect(sl).toContainEqual({ tag: 'h1', line: 1 })
    expect(sl).toContainEqual({ tag: 'ul', line: 2 })

    // parent li
    expect(sl).toContainEqual({ tag: 'li', line: 2 })

    // nested items: line 3 and line 5
    const liLines = sl.filter((r) => r.tag === 'li').map((r) => r.line)
    expect(liLines).toContain(3)
    expect(liLines).toContain(5)
  })

  it('handles deeply nested lists', () => {
    const html = parseMarkdown('- level 1\n  - level 2\n    - level 3\n- another\n')
    const sl = extractSourceLines(html)
    const liLines = sl.filter((r) => r.tag === 'li').map((r) => r.line)
    expect(liLines).toContain(1) // level 1
    expect(liLines).toContain(2) // level 2
    expect(liLines).toContain(3) // level 3
    expect(liLines).toContain(4) // another
  })
})

// ---------------------------------------------------------------------------
// Mixed content — sequential line accuracy
// ---------------------------------------------------------------------------

describe('source line annotation — mixed content', () => {
  it('tracks lines accurately through mixed block elements', () => {
    const content = [
      '# Heading', // 1
      '', // 2
      'A paragraph.', // 3
      '', // 4
      '- item one', // 5
      '- item two', // 6
      '', // 7
      '```sql', // 8
      'SELECT 1;', // 9
      '```', // 10
      '', // 11
      'After code.', // 12
      '', // 13
      '---', // 14
      '', // 15
      '## Next', // 16
      '',
    ].join('\n')

    const html = parseMarkdown(content)
    const sl = extractSourceLines(html)

    expect(sl).toContainEqual({ tag: 'h1', line: 1 })
    expect(sl).toContainEqual({ tag: 'p', line: 3 })
    expect(sl).toContainEqual({ tag: 'ul', line: 5 })
    expect(sl).toContainEqual({ tag: 'pre', line: 8 })
    const afterCode = sl.filter((r) => r.tag === 'p')
    expect(afterCode.some((r) => r.line === 12)).toBe(true)
    expect(sl).toContainEqual({ tag: 'hr', line: 14 })
    expect(sl).toContainEqual({ tag: 'h2', line: 16 })
  })

  it('tracks lines accurately through lists and code', () => {
    const content = [
      '# Title', // 1
      '', // 2
      'Intro paragraph.', // 3
      '', // 4
      '- bullet a', // 5
      '  - nested', // 6
      '- bullet b', // 7
      '', // 8
      '```', // 9
      'code', // 10
      '```', // 11
      '', // 12
      'Final.', // 13
      '',
    ].join('\n')

    const html = parseMarkdown(content)
    const sl = extractSourceLines(html)

    expect(sl).toContainEqual({ tag: 'h1', line: 1 })
    expect(sl).toContainEqual({ tag: 'p', line: 3 })
    expect(sl).toContainEqual({ tag: 'ul', line: 5 })
    expect(sl).toContainEqual({ tag: 'pre', line: 9 })

    const liLines = sl.filter((r) => r.tag === 'li').map((r) => r.line)
    expect(liLines).toContain(5) // bullet a
    expect(liLines).toContain(6) // nested
    expect(liLines).toContain(7) // bullet b

    const pLines = sl.filter((r) => r.tag === 'p').map((r) => r.line)
    expect(pLines).toContain(13) // Final.
  })
})

// ---------------------------------------------------------------------------
// Extensions — admonitions and KaTeX
// ---------------------------------------------------------------------------

describe('source line annotation — extensions', () => {
  it('annotates admonitions', () => {
    const content = 'text\n\n||info Title\nBody here.\n||\n\nafter\n'
    const html = parseMarkdown(content)
    expect(lineFor(html, 'div')).toBe(3)
  })

  it('annotates display math (blockKatex)', () => {
    const content = 'text\n\n$$\nx^2 + y^2 = z^2\n$$\n\nafter\n'
    const html = parseMarkdown(content)
    // The block katex should be annotated with a div
    const sl = extractSourceLines(html)
    const divLine = sl.find((r) => r.tag === 'div')
    expect(divLine).toBeDefined()
    expect(divLine!.line).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('source line annotation — edge cases', () => {
  it('handles empty content', () => {
    const html = parseMarkdown('')
    expect(lines(html)).toEqual([])
  })

  it('handles single line content', () => {
    const html = parseMarkdown('hello')
    expect(lineFor(html, 'p')).toBe(1)
  })

  it('handles consecutive headings', () => {
    const html = parseMarkdown('# One\n## Two\n### Three\n')
    const sl = extractSourceLines(html)
    expect(sl).toContainEqual({ tag: 'h1', line: 1 })
    expect(sl).toContainEqual({ tag: 'h2', line: 2 })
    expect(sl).toContainEqual({ tag: 'h3', line: 3 })
  })

  it('handles multiple code blocks', () => {
    const content = '```\nfirst\n```\n\n```\nsecond\n```\n'
    const html = parseMarkdown(content)
    const preTags = extractSourceLines(html).filter((r) => r.tag === 'pre')
    expect(preTags).toHaveLength(2)
    expect(preTags[0]!.line).toBe(1)
    expect(preTags[1]!.line).toBe(5)
  })

  it('does not put data-source-line on inline elements', () => {
    const html = parseMarkdown('hello **bold** world\n')
    // Only the <p> should have data-source-line, not <strong>
    expect(html).not.toMatch(/<strong[^>]*data-source-line/)
  })
})
