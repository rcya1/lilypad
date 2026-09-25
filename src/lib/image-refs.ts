// The `![alt](img:<uuid>){size?}` image reference syntax.

export interface ImageRefMatch {
  entryId: string
  from: number
  to: number
}

/** Fresh regex per call, so no shared `lastIndex` state. */
export function findImageRefs(text: string): ImageRefMatch[] {
  const pattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
  const results: ImageRefMatch[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    results.push({ entryId: m[1]!, from: m.index, to: m.index + m[0].length })
  }
  return results
}
