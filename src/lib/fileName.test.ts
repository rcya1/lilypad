import { describe, expect, it } from 'vitest'
import { joinExtension, splitExtension } from './fileName'

describe('splitExtension', () => {
  it('splits the last extension', () => {
    expect(splitExtension('notes.md')).toEqual({ stem: 'notes', ext: '.md' })
    expect(splitExtension('v1.2 notes.md')).toEqual({ stem: 'v1.2 notes', ext: '.md' })
  })

  it('treats dotfiles and dotless names as having no extension', () => {
    expect(splitExtension('.env')).toEqual({ stem: '.env', ext: '' })
    expect(splitExtension('README')).toEqual({ stem: 'README', ext: '' })
  })
})

describe('joinExtension', () => {
  it('appends the extension', () => {
    expect(joinExtension('notes', '.md')).toBe('notes.md')
  })

  it('does not double an extension the user typed', () => {
    expect(joinExtension('notes.md', '.md')).toBe('notes.md')
    expect(joinExtension('photo.PNG', '.png')).toBe('photo.png')
  })

  it('cannot change the extension', () => {
    expect(joinExtension('notes.txt', '.md')).toBe('notes.txt.md')
  })

  it('keeps a stem that is only the extension', () => {
    expect(joinExtension('.md', '.md')).toBe('.md.md')
  })
})
