// Markdown → HTML: KaTeX math, admonitions (`||type Title … ||`), image sizing, heading ids/TOC,
// and data-source-line attributes for editor ↔ preview sync.
import { Marked } from 'marked'
import type { Token, Tokens, RendererObject } from 'marked'
import markedKatex from 'marked-katex-extension'
import katex from 'katex'

/** Shared by inline and display math. */
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

/** Only these admonition types get an icon. */
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

/**
 * Admonitions: `||type Optional Title` … `||`. `type` becomes the `admonition-${type}` class; the
 * body is parsed as markdown.
 */
const admonition = {
  name: 'admonition',
  level: 'block' as const,
  start(src: string) {
    return src.match(/\|\|/)?.index
  },
  tokenizer(src: string): AdmonitionToken | undefined {
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
    const a = attr(token)
    return `<div${a} class="admonition admonition-${t.admonitionType}">
      <div class="admonition-title">${icon}<span>${escapeHtml(t.title)}</span></div>
      <div class="admonition-body">${body}</div>
    </div>`
  },
}

const escapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** `encode` also escapes existing entities (for attributes); otherwise they're left intact. */
function escapeHtml(s: string, encode = false): string {
  if (encode) return s.replace(/[&<>"']/g, (ch) => escapeMap[ch] ?? ch)
  return s.replace(/&(?!#?\w+;)|[<>"']/g, (ch) => escapeMap[ch] ?? ch)
}

/**
 * KaTeX's `throwOnError: false` only paints the broken tokens red and hides the reason in a
 * tooltip. On a parse error, show the best-effort render followed by the actual message.
 */
function renderMath(text: string, displayMode: boolean): string {
  try {
    return katex.renderToString(text, { throwOnError: true, displayMode, macros })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const partial = katex.renderToString(text, { throwOnError: false, displayMode, macros })
    return `${partial}<div class="katex-error-msg" role="alert">${escapeHtml(message)}</div>`
  }
}

/** Stamps each token with its 1-based source line (`_sourceLine`), for `data-source-line`. */
function annotateSourceLines(tokens: Token[], lineOffset: number) {
  let currentLine = 1
  for (const token of tokens) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(token as any)._sourceLine = lineOffset + currentLine

    if (token.type === 'list') {
      annotateListItems((token as Tokens.List).items, lineOffset + currentLine - 1)
    }

    if (token.raw) {
      currentLine += (token.raw.match(/\n/g) || []).length
    }
  }
}

/** marked nests list items inside the list token, so they need their own pass. */
function annotateListItems(items: Tokens.ListItem[], lineOffset: number) {
  let itemLine = 1
  for (const item of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(item as any)._sourceLine = lineOffset + itemLine

    // A nested list starts on the line after the text before it.
    let childNewlines = 0
    for (const child of item.tokens) {
      if (child.type === 'list') {
        const linesBeforeNested = childNewlines + 1
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(child as any)._sourceLine = lineOffset + itemLine + linesBeforeNested - 1
        annotateListItems(
          (child as Tokens.List).items,
          lineOffset + itemLine + linesBeforeNested - 2,
        )
      }
      if (child.raw) {
        childNewlines += (child.raw.match(/\n/g) || []).length
      }
    }

    if (item.raw) {
      itemLine += (item.raw.match(/\n/g) || []).length
    }
  }
}

function attr(token: Tokens.Generic): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = (token as any)._sourceLine
  return line != null ? ` data-source-line="${line}"` : ''
}

/**
 * Stamps block elements with `data-source-line` (one anchor per block is all the preview needs).
 */
const sourceLineRenderer: RendererObject = {
  heading(token: Tokens.Heading) {
    // Slugged in parseMarkdownWithToc so the id matches the TOC entry. Nested headings get none.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slug = (token as any)._slug as string | undefined
    const idAttr = slug ? ` id="${escapeHtml(slug, true)}"` : ''
    return `<h${token.depth}${idAttr}${attr(token)}>${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`
  },
  link(token: Tokens.Link) {
    const href = token.href || ''
    const text = this.parser.parseInline(token.tokens)
    // Highlight references (`[text](lily:hl-3)`) render as a chip with no real href, so they never
    // navigate; WebNotesPane/MarkdownPreview intercept clicks on the data attribute instead.
    if (href.startsWith('lily:')) {
      const ref = href.slice('lily:'.length)
      return `<a class="lily-ref" data-lily-ref="${escapeHtml(ref, true)}">${text}</a>`
    }
    const titleAttr = token.title ? ` title="${escapeHtml(token.title, true)}"` : ''
    return `<a href="${escapeHtml(href)}"${titleAttr}>${text}</a>`
  },
  paragraph(token: Tokens.Paragraph) {
    // An image-only paragraph renders as a bare <figure>: <figure> inside <p> is invalid, and the
    // browser splits them apart, losing data-source-line.
    const inlineTokens = token.tokens.filter((t) => t.type !== 'text' || t.raw.trim() !== '')
    if (inlineTokens.length === 1 && inlineTokens[0]!.type === 'image') {
      const html = this.parser.parseInline(token.tokens)
      return html.replace('<figure', `<figure${attr(token)}`) + '\n'
    }
    return `<p${attr(token)}>${this.parser.parseInline(token.tokens)}</p>\n`
  },
  code(token: Tokens.Code) {
    const lang = (token.lang || '').match(/^\S*/)?.[0]
    const text = token.text.replace(/\n$/, '') + '\n'
    const escaped = token.escaped ? text : escapeHtml(text, true)
    if (lang) {
      return `<pre${attr(token)}><code class="language-${escapeHtml(lang)}">${escaped}</code></pre>\n`
    }
    return `<pre${attr(token)}><code>${escaped}</code></pre>\n`
  },
  blockquote(token: Tokens.Blockquote) {
    return `<blockquote${attr(token)}>\n${this.parser.parse(token.tokens)}</blockquote>\n`
  },
  list(token: Tokens.List) {
    const tag = token.ordered ? 'ol' : 'ul'
    const startAttr = token.ordered && token.start !== 1 ? ` start="${token.start}"` : ''
    let body = ''
    for (const item of token.items) {
      // Wrap just the item's own text so a hover highlight doesn't bleed into nested lists.
      const textTokens = item.tokens.filter((t) => t.type !== 'list' && t.type !== 'space')
      const nestedListTokens = item.tokens.filter((t) => t.type === 'list')
      let content = ''
      if (textTokens.length > 0) {
        const textHtml = this.parser.parse(textTokens)
        // Loose lists emit <p> blocks, which can't go in a span; CSS targets `li > p` instead.
        content += item.loose ? textHtml : `<span class="li-text">${textHtml.trim()}</span>`
      }
      if (nestedListTokens.length > 0) {
        content += this.parser.parse(nestedListTokens)
      }
      body += `<li${attr(item as unknown as Tokens.Generic)}>${content}</li>\n`
    }
    return `<${tag}${startAttr}${attr(token)}>\n${body}</${tag}>\n`
  },
  table(token: Tokens.Table) {
    let header = ''
    for (const cell of token.header) {
      const alignAttr = cell.align ? ` align="${cell.align}"` : ''
      header += `<th${alignAttr}>${this.parser.parseInline(cell.tokens)}</th>\n`
    }
    header = `<tr>\n${header}</tr>\n`

    let body = ''
    for (const row of token.rows) {
      let rowStr = ''
      for (const cell of row) {
        const alignAttr = cell.align ? ` align="${cell.align}"` : ''
        rowStr += `<td${alignAttr}>${this.parser.parseInline(cell.tokens)}</td>\n`
      }
      body += `<tr>\n${rowStr}</tr>\n`
    }
    if (body) body = `<tbody>${body}</tbody>`

    return `<table${attr(token)}>\n<thead>\n${header}</thead>\n${body}</table>\n`
  },
  hr(token: Tokens.Hr) {
    return `<hr${attr(token)}>\n`
  },
}

/** Tailwind-style size hints (`w-1/2`, `h-200`, …) as inline CSS; unknown values → full width. */
function parseSizeToCSS(attr: string | null): string {
  if (!attr) return 'width: 100%;'

  if (attr === 'w-auto') return 'width: auto;'
  if (attr === 'w-full') return 'width: 100%;'
  if (attr === 'w-1/2') return 'width: 50%;'
  if (attr === 'w-1/3') return 'width: 33.333%;'
  if (attr === 'w-2/3') return 'width: 66.667%;'

  const wMatch = attr.match(/^w-(\d+)$/)
  if (wMatch) return `width: ${wMatch[1]}px;`

  const hMatch = attr.match(/^h-(\d+)$/)
  if (hMatch) return `height: ${hMatch[1]}px; width: auto;`

  return 'width: 100%;'
}

/** `![alt](src){w-1/2}` size hints, and `img:<uuid>` hrefs resolved via `imageResolver`. */
function createImageSizeExtension(imageResolver?: (imageId: string) => string | null) {
  return {
    name: 'image',
    level: 'inline' as const,
    start(src: string) {
      return src.indexOf('![') !== -1 ? src.indexOf('![') : undefined
    },
    tokenizer(src: string): Tokens.Generic | undefined {
      const match = src.match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{(w-[^}]+|h-[^}]+)\})?/)
      if (match) {
        return {
          type: 'image',
          raw: match[0],
          alt: match[1],
          href: match[2],
          sizeAttr: match[3] ?? null,
        } as unknown as Tokens.Generic
      }
      return undefined
    },
    renderer(token: Tokens.Generic): string {
      const style = parseSizeToCSS(token.sizeAttr as string | null)

      let src = token.href as string
      const imgMatch = (token.href as string).match(/^img:([a-f0-9-]+)$/)
      if (imgMatch && imageResolver) {
        const resolved = imageResolver(imgMatch[1]!)
        if (resolved) src = resolved
      }

      const caption = ((token.alt as string) ?? '').trim()
      const imgTag = `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}" style="${style}" />`
      const captionTag = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''

      return `<figure class="image-container">${imgTag}${captionTag}</figure>`
    },
  }
}

// Read by the image extension at render time, so one Marked instance serves every caller.
let activeImageResolver: ((imageId: string) => string | null) | undefined

const sharedMarked = new Marked()
sharedMarked.use(markedKatex({ throwOnError: false, macros }))
sharedMarked.use({ extensions: [admonition] })
sharedMarked.use({ breaks: true, renderer: sourceLineRenderer })
sharedMarked.use({
  extensions: [
    {
      name: 'blockKatex',
      renderer(token: Tokens.Generic) {
        const a = attr(token)
        // `katex-block` lets the preview target display-math blocks for highlighting
        // (full-width, so the centered equation stays centered — see MarkdownPreview.vue).
        return `<div${a} class="katex-block">${renderMath(token.text as string, token.displayMode as boolean)}</div>\n`
      },
    },
    // Inline math can't show a block message: errors show the source in red, message as tooltip.
    {
      name: 'inlineKatex',
      renderer(token: Tokens.Generic) {
        try {
          return katex.renderToString(token.text as string, {
            throwOnError: true,
            displayMode: token.displayMode as boolean,
            macros,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return `<span class="katex-error-inline" title="${escapeHtml(message, true)}">${escapeHtml(token.text as string)}</span>`
        }
      },
    },
    // marked-katex only treats `$$` as block math on lines of its own; a one-line `$$…$$` is parsed
    // inline and swallowed into the paragraph before it. This lets a line-initial `$$` end the
    // paragraph, and tokenizes one-line `$$…$$` as a block. Multi-line blocks still go through
    // marked-katex (the no-newline lookahead).
    {
      name: 'blockKatexBreak',
      level: 'block' as const,
      start(src: string) {
        return src.match(/\n\$\$|\n\$\n/)?.index
      },
      tokenizer(src: string): Tokens.Generic | undefined {
        const match = /^\$\$(?!\n)((?:\\[^]|[^\\])+?)\$\$(?:\n|$)/.exec(src)
        if (match) {
          return {
            type: 'blockKatex',
            raw: match[0],
            text: match[1]!.trim(),
            displayMode: true,
          } as unknown as Tokens.Generic
        }
        return undefined
      },
    },
  ],
})
sharedMarked.use({
  extensions: [createImageSizeExtension((id) => activeImageResolver?.(id) ?? null)],
})
// A text line followed by a single `-` would become a Setext <h2>, which mangles text as soon as
// you start an empty bullet on the next line. Require `--` for that; `=` is unchanged.
// (`undefined` = not a heading; `false` = marked's default handling.)
sharedMarked.use({
  tokenizer: {
    lheading(src: string) {
      const match = /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/.exec(src)
      if (match && match[2] === '-') return undefined
      return false
    },
  },
})

export interface TocItem {
  depth: number
  /** Inline markdown flattened for display (the slug uses the raw text). */
  text: string
  /** Matches the heading's rendered `id`. */
  id: string
}

// Cleared per parse so slugs don't leak between documents. `usedSlugs` stops a suffixed slug from
// colliding with a heading whose own text slugs to it (`## A`, `## A`, `## A-1`).
const slugCounts = new Map<string, number>()
const usedSlugs = new Set<string>()

// For headings with no slug-able characters (punctuation, non-Latin script): an empty id can't
// be targeted, and `querySelector('#')` throws.
const EMPTY_SLUG_FALLBACK = 'section'

/** GitHub-style; repeats get `-1`, `-2`, …. Call exactly once per heading per parse. */
function slugify(text: string): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '') || EMPTY_SLUG_FALLBACK
  let seen = slugCounts.get(base) ?? 0
  let slug = seen === 0 ? base : `${base}-${seen}`
  while (usedSlugs.has(slug)) {
    seen++
    slug = `${base}-${seen}`
  }
  slugCounts.set(base, seen + 1)
  usedSlugs.add(slug)
  return slug
}

/** TOC display text: inline markdown flattened (HTML dropped, math keeps its TeX). */
function inlinePlainText(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const t of tokens) {
    if (t.type === 'html') continue
    if ('tokens' in t && Array.isArray(t.tokens)) out += inlinePlainText(t.tokens)
    else if ('text' in t && typeof t.text === 'string') out += t.text
  }
  return out
}

/**
 * Renders and collects a TOC of the top-level headings in one pass. Each slug is stored on its
 * token so the rendered id and the TOC id can't drift.
 */
export function parseMarkdownWithToc(
  content: string,
  imageResolver?: (imageId: string) => string | null,
): { html: string; toc: TocItem[] } {
  activeImageResolver = imageResolver
  slugCounts.clear()
  usedSlugs.clear()
  const tokens = sharedMarked.lexer(content)
  annotateSourceLines(tokens, 0)

  const toc: TocItem[] = []
  for (const token of tokens) {
    if (token.type !== 'heading') continue
    const heading = token as Tokens.Heading
    const slug = slugify(heading.text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(heading as any)._slug = slug
    toc.push({
      depth: heading.depth,
      text: inlinePlainText(heading.tokens).trim() || heading.text,
      id: slug,
    })
  }

  const html = sharedMarked.parser(tokens)
  return { html, toc }
}

export function parseMarkdown(
  content: string,
  imageResolver?: (imageId: string) => string | null,
): string {
  return parseMarkdownWithToc(content, imageResolver).html
}
