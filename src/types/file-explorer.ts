export type Entry = Directory | Document

export interface Directory {
  kind: 'directory'
  name: string
  children: (Directory | Document)[]
}

export type DocumentType = 'pdf' | 'txt'

export interface Document {
  kind: 'document'
  name: string
  type: DocumentType
}

export function isDirectory(entry: Entry): entry is Directory {
  return entry.kind === 'directory'
}
