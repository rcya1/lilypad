// Single definition of the ![alt](img:<uuid>){size?} reference syntax used in notes.

export interface ImageRefMatch {
  entryId: string
  from: number
  to: number
}

/**
 * Finds all image references in `text`. A fresh regex is created per call so no
 * lastIndex state leaks between callers (module-level /g regexes are stateful).
 */
export function findImageRefs(text: string): ImageRefMatch[] {
  const pattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
  const results: ImageRefMatch[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    results.push({ entryId: m[1]!, from: m.index, to: m.index + m[0].length })
  }
  return results
}
