import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// saveDocument uses these stores.
const uploadContent = vi.fn(async () => true)
vi.mock('@/stores/files', () => ({
  useFilesStore: () => ({ uploadContent }),
}))
const addToast = vi.fn()
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

import { useEditorStore } from './editor'

beforeEach(() => {
  setActivePinia(createPinia())
  uploadContent.mockClear()
  uploadContent.mockResolvedValue(true)
  addToast.mockClear()
})

describe('openDocument', () => {
  it('adds to openDocuments and tabOrder, sets active', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    expect(store.openDocuments.get('a')?.content).toBe('hello')
    expect(store.tabOrder).toEqual(['a'])
    expect(store.activeDocumentId).toBe('a')
  })

  it('activates an already-open id without duplicating the tab', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.openDocument('b', 'b.md', 'md', 'world')
    store.openDocument('a', 'a.md', 'md', 'hello')
    expect(store.tabOrder).toEqual(['a', 'b'])
    expect(store.activeDocumentId).toBe('a')
  })
})

describe('preview semantics', () => {
  it('openDocumentAsPreview sets previewDocumentId', () => {
    const store = useEditorStore()
    store.openDocumentAsPreview('a', 'a.md', 'md', 'hello')
    expect(store.previewDocumentId).toBe('a')
  })

  it('opening a second preview replaces the first in the same tab slot', () => {
    const store = useEditorStore()
    store.openDocument('x', 'x.md', 'md', '')
    store.openDocumentAsPreview('a', 'a.md', 'md', 'hello')
    store.openDocumentAsPreview('b', 'b.md', 'md', 'world')
    expect(store.tabOrder).toEqual(['x', 'b'])
    expect(store.previewDocumentId).toBe('b')
    expect(store.openDocuments.has('a')).toBe(false)
  })

  it('a document already open as a permanent tab is not converted to a preview', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.openDocumentAsPreview('a', 'a.md', 'md', 'hello')
    expect(store.previewDocumentId).toBeNull()
    expect(store.activeDocumentId).toBe('a')
  })

  it('promotePreview clears preview status', () => {
    const store = useEditorStore()
    store.openDocumentAsPreview('a', 'a.md', 'md', 'hello')
    store.promotePreview('a')
    expect(store.previewDocumentId).toBeNull()
  })

  it('updateContent on a preview promotes it', () => {
    const store = useEditorStore()
    store.openDocumentAsPreview('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    expect(store.previewDocumentId).toBeNull()
  })
})

describe('updateContent auto-save debounce', () => {
  it('marks dirty', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    expect(store.dirtyIds.has('a')).toBe(true)
  })

  it('advancing 5000ms triggers exactly one uploadContent call', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    vi.advanceTimersByTime(5000)
    expect(uploadContent).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('typing again before 5000ms resets the timer', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    vi.advanceTimersByTime(4000)
    store.updateContent('a', 'hello!!')
    vi.advanceTimersByTime(4000)
    expect(uploadContent).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(uploadContent).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('saveDocument', () => {
  it('clears the dirty flag on success', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    await store.saveDocument('a')
    expect(store.dirtyIds.has('a')).toBe(false)
  })

  it('leaves the dirty flag set if content changed while the upload was in flight', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')

    let resolveUpload: (v: boolean) => void = () => {}
    uploadContent.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUpload = resolve
        }),
    )
    const savePromise = store.saveDocument('a')
    store.updateContent('a', 'hello!!')
    resolveUpload(true)
    await savePromise

    expect(store.dirtyIds.has('a')).toBe(true)
  })

  it('shows a toast on failure', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    uploadContent.mockResolvedValueOnce(false)
    await store.saveDocument('a')
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('Failed to save'), 'error')
  })
})

describe('closeDocument', () => {
  it('saves dirty content before removing', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', 'hello')
    store.updateContent('a', 'hello!')
    await store.closeDocument('a')
    expect(uploadContent).toHaveBeenCalledTimes(1)
    expect(store.openDocuments.has('a')).toBe(false)
  })

  it('activates the tab to the left when closing the active tab', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.openDocument('b', 'b.md', 'md', '')
    store.openDocument('c', 'c.md', 'md', '')
    store.setActiveDocument('b')
    await store.closeDocument('b')
    expect(store.activeDocumentId).toBe('a')
  })

  it('activates the tab to the right if leftmost', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.openDocument('b', 'b.md', 'md', '')
    store.setActiveDocument('a')
    await store.closeDocument('a')
    expect(store.activeDocumentId).toBe('b')
  })

  it('removing the only tab leaves activeDocumentId null', async () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    await store.closeDocument('a')
    expect(store.activeDocumentId).toBeNull()
  })
})

describe('moveTab', () => {
  it('moving right adjusts the index correctly', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.openDocument('b', 'b.md', 'md', '')
    store.openDocument('c', 'c.md', 'md', '')
    store.moveTab('a', 2)
    expect(store.tabOrder).toEqual(['b', 'a', 'c'])
  })

  it('moving left works', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.openDocument('b', 'b.md', 'md', '')
    store.openDocument('c', 'c.md', 'md', '')
    store.moveTab('c', 0)
    expect(store.tabOrder).toEqual(['c', 'a', 'b'])
  })

  it('unknown id is a no-op', () => {
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.moveTab('nope', 0)
    expect(store.tabOrder).toEqual(['a'])
  })
})

describe('$reset', () => {
  it('clears everything and cancels pending save timers', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    store.openDocument('a', 'a.md', 'md', '')
    store.updateContent('a', 'hello!')
    store.$reset()
    expect(store.openDocuments.size).toBe(0)
    expect(store.tabOrder).toEqual([])
    expect(store.activeDocumentId).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(uploadContent).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
