// Editor LaTeX parser: tokenizer, tree shape, and agreeing with the preview on what is math.
import { describe, it, expect } from 'vitest'
import { parser as baseParser } from '@lezer/markdown'
import { latexMath, matchInlineMath, tokenizeLatex } from './latex'
import { parseMarkdown } from '@/lib/markdown'

const parser = baseParser.configure([latexMath])

function nodesOf(doc: string, name: string): string[] {
  const out: string[] = []
  parser.parse(doc).iterate({
    enter(node) {
      if (node.name === name) out.push(doc.slice(node.from, node.to))
    },
  })
  return out
}

function tokens(src: string): string[] {
  return tokenizeLatex(src).map((t) => `${t.type}:${src.slice(t.from, t.to)}`)
}

describe('tokenizeLatex', () => {
  it('tokenizes commands, braces, scripts and numbers', () => {
    expect(tokens('\\frac{a}{2.5}^x_1')).toEqual([
      'MathCommand:\\frac',
      'MathBrace:{',
      'MathBrace:}',
      'MathBrace:{',
      'MathNumber:2.5',
      'MathBrace:}',
      'MathScript:^',
      'MathScript:_',
      'MathNumber:1',
    ])
  })

  it('handles environments, alignment, control symbols and comments', () => {
    expect(tokens('\\begin{align*} a &= b \\\\ \\, \\% x % note')).toEqual([
      'MathCommand:\\begin',
      'MathBrace:{',
      'MathEnvName:align*',
      'MathBrace:}',
      'MathAlign:&',
      'MathAlign:\\\\',
      'MathCommand:\\,',
      'MathCommand:\\%',
      'MathComment:% note',
    ])
  })

  it('offsets positions', () => {
    expect(tokenizeLatex('\\a', 10)).toEqual([{ type: 'MathCommand', from: 10, to: 12 }])
  })
})

describe('matchInlineMath', () => {
  it('requires a valid preceding character', () => {
    expect(matchInlineMath('$x$ ', null)).not.toBeNull()
    expect(matchInlineMath('$x$ ', ' ')).not.toBeNull()
    expect(matchInlineMath('$x$ ', 'a')).toBeNull()
    expect(matchInlineMath('$x$ ', '(')).toBeNull()
  })

  it('requires a valid following character', () => {
    expect(matchInlineMath('$x$', null)?.length).toBe(3)
    expect(matchInlineMath('$x$.', null)?.length).toBe(3)
    expect(matchInlineMath('$x$a', null)).toBeNull()
    expect(matchInlineMath('$x$)', null)).toBeNull()
  })

  it('handles display delimiters and escapes', () => {
    expect(matchInlineMath('$$x$$ y', null)).toEqual({ markLen: 2, length: 5 })
    expect(matchInlineMath('$a\\$b$', null)?.length).toBe(6)
    expect(matchInlineMath('$ $', null)).not.toBeNull()
    expect(matchInlineMath('$$', null)).toBeNull()
  })
})

describe('latexMath lezer extension', () => {
  it('parses inline math with marks and LaTeX tokens', () => {
    const doc = 'Let $\\alpha^2$ be.'
    expect(nodesOf(doc, 'InlineMath')).toEqual(['$\\alpha^2$'])
    expect(nodesOf(doc, 'MathMark')).toEqual(['$', '$'])
    expect(nodesOf(doc, 'MathCommand')).toEqual(['\\alpha'])
  })

  it('parses fenced display math and interrupts paragraphs', () => {
    const doc = 'Text\n$$\n\\begin{aligned}\na &= 1 \\\\\n\\end{aligned}\n$$\nAfter *em*'
    expect(nodesOf(doc, 'BlockMath')).toEqual([
      '$$\n\\begin{aligned}\na &= 1 \\\\\n\\end{aligned}\n$$',
    ])
    expect(nodesOf(doc, 'Paragraph')).toEqual(['Text', 'After *em*'])
    expect(nodesOf(doc, 'Emphasis')).toEqual(['*em*'])
    expect(nodesOf(doc, 'MathEnvName')).toEqual(['aligned', 'aligned'])
  })

  it('parses one-line display math as a block', () => {
    expect(nodesOf('a\n$$x^2$$\nb', 'BlockMath')).toEqual(['$$x^2$$'])
  })

  it('keeps block math inside its container', () => {
    const doc = '> $$\n> x\n> $$\n\nafter'
    expect(nodesOf(doc, 'BlockMath')).toEqual(['$$\n> x\n> $$'])
    expect(nodesOf(doc, 'QuoteMark')).toHaveLength(3)
    // Unclosed fence runs to the end of the list item (trailing blank line included).
    expect(nodesOf('- $$\n  x\n\nnot math', 'BlockMath')).toEqual(['$$\n  x\n'])
  })

  it('ignores escaped dollars and dollars in code', () => {
    expect(nodesOf('cost \\$5 and \\$6 ', 'InlineMath')).toEqual([])
    expect(nodesOf('`$x$ ` and $y$', 'InlineMath')).toEqual(['$y$'])
    expect(nodesOf('```\n$$\nx\n$$\n```', 'BlockMath')).toEqual([])
    expect(nodesOf('    $$\n    x', 'BlockMath')).toEqual([])
  })

  it('does not let math content form markdown', () => {
    const doc = '$a_1 * b_2 *$ text'
    expect(nodesOf(doc, 'InlineMath')).toEqual(['$a_1 * b_2 *$'])
    expect(nodesOf(doc, 'Emphasis')).toEqual([])
  })
})

function previewMathCount(doc: string): number {
  return (parseMarkdown(doc).match(/class="katex"/g) ?? []).length
}

function editorMathCount(doc: string): number {
  return nodesOf(doc, 'InlineMath').length + nodesOf(doc, 'BlockMath').length
}

describe('parity with the preview renderer', () => {
  const cases = [
    'Let $x$ be a number.',
    '$x$ at the start',
    'no space before a$x$ here',
    'wrapped ($x$) in parens',
    'followed by letter $x$y',
    'price $5 and $10 total',
    'escaped \\$x$ here',
    'code `$x$` here',
    'inline display $$x^2$$ here',
    'two $a$ and $b$.',
    'bold **$x$** math',
    'emph *$x$ y* math',
    'link [$x$](http://a.b) text',
    'line one\n$x$ on line two',
    'tab\t$x$ before',
    '$$\nx^2\n$$',
    'para\n$$\n\\frac{1}{2}\n$$\nafter',
    '$$x+y$$',
    '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$',
    '- item $x$\n- $$\n  y\n  $$',
    '> quote $x$',
  ]
  for (const doc of cases) {
    it(JSON.stringify(doc), () => {
      expect(editorMathCount(doc)).toBe(previewMathCount(doc))
    })
  }
})
