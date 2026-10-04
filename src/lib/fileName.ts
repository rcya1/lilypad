// Splitting file names into an editable stem and a locked extension, so renames can't change type.

/** "notes.md" → { stem: "notes", ext: ".md" }. Dotfiles and names without a dot have no ext. */
export function splitExtension(name: string): { stem: string; ext: string } {
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx <= 0) return { stem: name, ext: '' }
  return { stem: name.slice(0, dotIdx), ext: name.slice(dotIdx) }
}

/** Reattaches `ext` to a user-typed stem, dropping it first if they typed it themselves. */
export function joinExtension(stem: string, ext: string): string {
  if (ext && stem.length > ext.length && stem.toLowerCase().endsWith(ext.toLowerCase())) {
    stem = stem.slice(0, -ext.length)
  }
  return stem + ext
}
