export type Entry = Directory | Document

export interface Directory {
  kind: 'directory'
  id: string
  name: string
  parentId: string | null
  children: (Directory | Document)[]
}

export type DocumentType = 'pdf' | 'md'

export interface Document {
  kind: 'document'
  id: string
  name: string
  parentId: string | null
  type: DocumentType
}

export function isDirectory(entry: Entry): entry is Directory {
  return entry.kind === 'directory'
}
