// Custom marked renderer: KaTeX math, admonitions (||type Title … ||), image sizing, and source-line annotation for editor-preview sync.
import { Marked } from 'marked'
import type { Token, Tokens, RendererObject } from 'marked'
import markedKatex from 'marked-katex-extension'
import katex from 'katex'

/**
 * KaTeX macro shortcuts passed to both the marked-katex-extension and the
 * blockKatex renderer so inline and display math share the same definitions.
 */
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

/** Inline SVG icons keyed by admonition type — only types listed here get an icon. */
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
 * Custom marked block extension for admonitions.
 *
 * Syntax:
 * ```
 * ||type Optional Title
 * Body text here.
 * ||
 * ```
 * `type` maps to a CSS class (`admonition-${type}`) and optionally to an icon in `admonitionIcons`.
 * The body is recursively parsed as markdown so nested formatting works.
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

/**
 * Escape HTML special characters.
 * @param encode - When true, also escapes `&` unconditionally (for attribute values).
 *                 When false, skips already-encoded entities (for text content).
 */
function escapeHtml(s: string, encode = false): string {
  if (encode) return s.replace(/[&<>"']/g, (ch) => escapeMap[ch] ?? ch)
  return s.replace(/&(?!#?\w+;)|[<>"']/g, (ch) => escapeMap[ch] ?? ch)
}

/**
 * Render a math expression to HTML with a visible diagnostic on failure.
 *
 * KaTeX's `throwOnError: false` silently paints only the broken tokens red and buries the
 * reason in a `title` tooltip. Instead we render once strictly (`throwOnError: true`); on
 * success we return that HTML, and on a `ParseError` we still show the best-effort partial
 * render (so the good part of the equation is visible) followed by the exact error message
 * (e.g. "KaTeX parse error: Undefined control sequence: \foo at position 3: …").
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

/**
 * Mutates each token in `tokens` to add a `_sourceLine` property indicating which
 * 1-indexed source line the token starts on. Used by the renderer to emit
 * `data-source-line` attributes, which the preview uses to sync click-to-line with the editor.
 *
 * @param lineOffset - Number of lines already consumed before this token list (0 for top-level).
 */
function annotateSourceLines(tokens: Token[], lineOffset: number) {
  let currentLine = 1
  for (const token of tokens) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(token as any)._sourceLine = lineOffset + currentLine

    // Annotate individual list items and recurse into nested lists
    if (token.type === 'list') {
      annotateListItems((token as Tokens.List).items, lineOffset + currentLine - 1)
    }

    if (token.raw) {
      currentLine += (token.raw.match(/\n/g) || []).length
    }
  }
}

/**
 * Recursively annotates list items with source lines.
 * Lists are special because marked's token model nests items inside the list token rather than
 * flattening them, so a separate traversal is required.
 *
 * @param lineOffset - Line number of the line immediately before the first item.
 */
function annotateListItems(items: Tokens.ListItem[], lineOffset: number) {
  let itemLine = 1
  for (const item of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(item as any)._sourceLine = lineOffset + itemLine

    // Recurse into child tokens to find nested lists.
    // Count newlines in preceding sibling tokens to determine where the nested list starts.
    let childNewlines = 0
    for (const child of item.tokens) {
      if (child.type === 'list') {
        const linesBeforeNested = childNewlines + 1 // +1 because nested list starts on next line
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

/**
 * Reads `_sourceLine` from a token (set by `annotateSourceLines`) and returns
 * the `data-source-line` attribute string, or an empty string if absent.
 * Called inside every renderer method to stamp the HTML with source positions.
 */
function attr(token: Tokens.Generic): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const line = (token as any)._sourceLine
  return line != null ? ` data-source-line="${line}"` : ''
}

/**
 * Overrides for each block-level marked renderer method to inject `data-source-line`
 * attributes. Only block elements are annotated — inline elements (strong, em, etc.)
 * are not, since the preview sync only needs one anchor per block.
 */
const sourceLineRenderer: RendererObject = {
  heading(token: Tokens.Heading) {
    // Slug is pre-assigned per top-level heading in parseMarkdownWithToc so the id here and the
    // TOC entry share one slugger pass (see slugify). Nested headings carry no slug → no id.
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
    // If the paragraph contains only an image, render the <figure> as a
    // block element directly (a <figure> inside a <p> is invalid HTML and
    // browsers break them apart, losing the data-source-line attribute).
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
      // Separate inline text tokens from nested list tokens so we can wrap only
      // the text portion in a span. This lets CSS highlight just the hovered text
      // without the background bleeding into child list items.
      const textTokens = item.tokens.filter((t) => t.type !== 'list' && t.type !== 'space')
      const nestedListTokens = item.tokens.filter((t) => t.type === 'list')
      let content = ''
      if (textTokens.length > 0) {
        const textHtml = this.parser.parse(textTokens)
        // For tight lists the inline text has no <p> wrapper — safe to put in a span.
        // For loose lists parse() emits <p>…</p> blocks which are invalid inside a span,
        // so we leave them bare and CSS targets li.preview-hover > p instead.
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

/**
 * Converts an image size modifier string (e.g. `w-1/2`, `h-200`) to an inline CSS string.
 * Mirrors a subset of Tailwind class names to avoid importing Tailwind inside the renderer.
 * Unknown values fall back to `width: 100%`.
 */
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

/**
 * Creates a marked inline extension that adds optional size modifiers to image syntax.
 *
 * Extended syntax: `![alt](src){w-1/2}` where the `{...}` block is a Tailwind-style size hint.
 * Also handles `img:<uuid>` hrefs by resolving them to real URLs via `imageResolver`.
 *
 * @param imageResolver - Optional callback that maps an image UUID to a public URL.
 *                        If omitted (e.g. in tests), `img:` hrefs are left as-is.
 */
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

/**
 * Parse markdown content to HTML with all Lilypad extensions applied.
 *
 * Extensions (in application order):
 * 1. `marked-katex-extension` — inline (`$…$`) and display (`$$…$$`) math via KaTeX
 * 2. `admonition` — custom block callouts (`||type Title … ||`)
 * 3. `sourceLineRenderer` — stamps every block element with `data-source-line`
 * 4. `blockKatex` renderer override — wraps block math in a `<div>` with source-line annotation
 * 5. `createImageSizeExtension` — `{w-*}` / `{h-*}` size modifiers on images
 *
 * @param content       - Raw markdown string to parse.
 * @param imageResolver - Optional callback to resolve `img:<uuid>` hrefs to URLs.
 *                        Pass the files store's `getImageUrl` when rendering in the app;
 *                        omit in tests where image resolution isn't needed.
 * @returns             The rendered HTML string.
 */
// The image extension reads this at render time so one shared Marked instance can serve
// every caller; parseMarkdown sets it before each parse.
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
    // Override marked-katex's inline renderer so inline `$…$` errors surface a diagnostic too.
    // A block error message would break the inline flow, so on failure we render the raw source
    // in red with the full KaTeX message in a hover tooltip (`title`).
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
    // marked-katex-extension only recognises *block* display math when the `$$` delimiters sit
    // on their own lines (`$$\n…\n$$`); a one-line `$$…$$` falls through to the inline rule and
    // gets absorbed into a preceding paragraph, sharing its source line and rendering inline.
    // This extension (a) registers a `start` so any `$$` opener at the head of a line interrupts
    // the current paragraph, and (b) tokenizes a one-line `$$…$$` as its own block-level
    // `blockKatex` token. Multi-line `$$\n…\n$$` still falls through to marked-katex's own
    // block tokenizer (the `(?!\n)` guard rejects it here).
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
// Soften Setext (underline) headings: a line of text followed by a single `-`
// underline normally becomes an <h2>, which mangles ordinary text the moment you
// start an empty bullet list on the next line. Require at least two dashes (`--`)
// before treating a `-` underline as a heading; `=` underlines are unchanged.
// Returning `undefined` tells marked "no heading here" (falls through to paragraph);
// returning `false` defers to marked's built-in lheading behavior.
sharedMarked.use({
  tokenizer: {
    lheading(src: string) {
      const match = /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/.exec(src)
      if (match && match[2] === '-') return undefined
      return false
    },
  },
})

/** A single entry in a document's table of contents, one per top-level heading. */
export interface TocItem {
  /** Heading level, 1–6. */
  depth: number
  /** Plain heading text (the token's raw text). */
  text: string
  /** GitHub-style slug; matches the `id` rendered onto the heading. */
  id: string
}

// Per-parse slug dedupe counts, cleared at the top of each parse (same lifecycle as
// activeImageResolver) so slugs never leak between documents.
const slugCounts = new Map<string, number>()

/**
 * GitHub-style heading slug: lowercase, spaces→hyphens, strip anything but [a-z0-9-_].
 * Repeats within one document get `-1`, `-2`, … suffixes. Relies on `slugCounts` being cleared
 * once per parse; every heading must be slugged exactly once so the counter stays accurate.
 */
function slugify(text: string): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
  const seen = slugCounts.get(base) ?? 0
  slugCounts.set(base, seen + 1)
  return seen === 0 ? base : `${base}-${seen}`
}

/**
 * Parse markdown to HTML and, in the same pass, collect a table of contents from the top-level
 * headings. Each heading is slugged once here and the slug is stashed on the token so the renderer
 * emits the identical `id` — the TOC ids and the rendered ids can never drift.
 *
 * @param content       - Raw markdown string to parse.
 * @param imageResolver - Optional callback to resolve `img:<uuid>` hrefs to URLs.
 * @returns             The rendered HTML and the ordered list of heading TOC items.
 */
export function parseMarkdownWithToc(
  content: string,
  imageResolver?: (imageId: string) => string | null,
): { html: string; toc: TocItem[] } {
  activeImageResolver = imageResolver
  slugCounts.clear()
  const tokens = sharedMarked.lexer(content)
  annotateSourceLines(tokens, 0)

  const toc: TocItem[] = []
  for (const token of tokens) {
    if (token.type !== 'heading') continue
    const heading = token as Tokens.Heading
    const slug = slugify(heading.text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(heading as any)._slug = slug
    toc.push({ depth: heading.depth, text: heading.text, id: slug })
  }

  const html = sharedMarked.parser(tokens)
  return { html, toc }
}

/** Parse markdown to HTML. Thin wrapper over parseMarkdownWithToc that discards the TOC. */
export function parseMarkdown(
  content: string,
  imageResolver?: (imageId: string) => string | null,
): string {
  return parseMarkdownWithToc(content, imageResolver).html
}
