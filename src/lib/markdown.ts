import { Marked } from 'marked'
import type { Token, Tokens } from 'marked'
import markedKatex from 'marked-katex-extension'

const macros = {
  '\\integers': '\\mathbb{Z}',
  '\\naturals': '\\mathbb{N}',
  '\\rationals': '\\mathbb{Q}',
  '\\complex': '\\mathbb{C}',
  '\\vare': '\\varepsilon',
  '\\set': '\\left\\{ #1 \\right\\}',
  '\\card': '\\left| #1\\right|',
  '\\abs': '\\left| #1\\right|',
  '\\mag': '\\left| #1\\right|',
  '\\norm': '\\left|\\left| #1\\right|\\right|',
  '\\floor': '\\left\\lfloor #1 \\right\\rfloor',
  '\\ceil': '\\left\\lceil #1 \\right\\rceil',
  '\\ang': '\\left\\langle #1 \\right\\rangle',
  '\\bracket': '\\left[#1\\right]',
  '\\curly': '\\left\\{#1\\right\\}',
  '\\paren': '\\left( #1 \\right)',
  '\\prob': '\\text{Pr} \\left[ #1 \\right]',
  '\\exp': '\\mathbb{E}\\left[ #1 \\right]',
  '\\expsq': '\\mathbb{E}^2\\left[ #1 \\right]',
  '\\var': '\\text{Var}\\left[ #1 \\right]',
  '\\pmod': '\\allowbreak\\mkern12mu({\\rm mod}\\,\\,#1)',
  '\\percent': '#1\\%',
  '\\real': '\\Re\\left(#1\\right)',
  '\\comp': '\\Im\\left(#1\\right)',
  '\\deriv': '\\frac{d #1}{d #2}',
  '\\pfrac': '\\frac{\\partial #1}{\\partial #2}',
  '\\limi': '\\lim_{#1 \\rightarrow \\infty}',
  '\\limit': '\\lim_{#1 \\rightarrow #2}',
  '\\vec': '\\mathbf{#1}',
  '\\veca': '\\begin{bmatrix*}#1\\end{bmatrix*}',
  '\\trace': '\\text{Tr}\\left(#1\\right)',
  '\\cov': '\\text{Cov}\\left(#1\\right)',
  '\\mc': '\\mathcal{#1}',
  '\\p': '\\paren{#1}',
  '\\t': '\\text{#1}',
}

const admonitionIcons: Record<string, string> = {
  info: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  definition:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
  theorem:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  proposition:
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
}

interface AdmonitionToken {
  type: 'admonition'
  raw: string
  body: string
  title: string
  admonitionType: string
  tokens: Token[]
}

const admonition = {
  name: 'admonition',
  level: 'block' as const,
  start(src: string) {
    return src.match(/\|\|/)?.index
  },
  tokenizer(src: string, _tokens: Token[]): AdmonitionToken | undefined {
    const rule = /^\|\|([\s\S]*?)\|\|/
    const match = rule.exec(src)
    if (match) {
      const text = match[0].trim()
      const firstLine = (text.split('\n')[0] ?? '').replace(/\|\|/g, '').trim()
      const parts = firstLine.split(' ')
      const type = parts[0] ?? 'info'
      let title = firstLine.replace(type, '').trim()
      const body = text.replace(firstLine, '').replace(/\|\|/g, '').trim()

      if (type === 'proposition') {
        title = 'Proposition: ' + title
      }

      const token: AdmonitionToken = {
        type: 'admonition',
        raw: match[0],
        body,
        title,
        admonitionType: type,
        tokens: [],
      }
      // @ts-expect-error — marked extension lexer is injected at runtime
      this.lexer.blockTokens(token.body, token.tokens)
      return token
    }
    return undefined
  },
  renderer(token: Tokens.Generic): string {
    const t = token as unknown as AdmonitionToken
    const icon = admonitionIcons[t.admonitionType] ?? ''
    // @ts-expect-error — marked extension parser is injected at runtime
    const body: string = this.parser.parse(t.tokens)
    return `<div class="admonition admonition-${t.admonitionType}">
      <div class="admonition-title">${icon}<span>${t.title}</span></div>
      <div class="admonition-body">${body}</div>
    </div>`
  },
}

export async function parseMarkdown(content: string): Promise<string> {
  // Strip YAML front matter
  if (content.startsWith('---')) {
    content = content.split('---').slice(2).join('---')
  }

  const marked = new Marked()
  marked.use(markedKatex({ throwOnError: false, macros }))
  marked.use({ extensions: [admonition] })

  return await marked.parse(content, { breaks: true })
}
