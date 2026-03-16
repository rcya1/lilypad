import { defineStore } from 'pinia'
import { ref } from 'vue'

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24

export interface VimMapping {
  id: string
  lhs: string
  rhs: string
  mode: 'normal' | 'insert' | 'visual'
  noremap: boolean
}

function clampFontSize(n: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))
}

function readFontSize(key: string, defaultVal: number): number {
  const raw = localStorage.getItem(key)
  if (raw === null) return defaultVal
  const n = parseInt(raw, 10)
  if (isNaN(n)) return defaultVal
  return clampFontSize(n)
}

function readVimEscTimeout(): number {
  const raw = localStorage.getItem('vim-esc-timeout')
  if (!raw) return 200
  const n = parseInt(raw, 10)
  return isNaN(n) ? 200 : n
}

function readVimMappings(): VimMapping[] {
  try {
    const raw = localStorage.getItem('vim-mappings')
    return raw ? (JSON.parse(raw) as VimMapping[]) : []
  } catch {
    return []
  }
}

export const useUiStore = defineStore('ui', () => {
  const previewVisible = ref(localStorage.getItem('preview-visible') !== 'false')
  const previewFontSize = ref(readFontSize('preview-font-size', 15))
  const editorFontSize = ref(readFontSize('editor-font-size', 13))
  const vimEnabled = ref(localStorage.getItem('vim-enabled') !== 'false')
  const vimEscTimeout = ref(readVimEscTimeout())
  const vimMappings = ref<VimMapping[]>(readVimMappings())
  const highlightOnYank = ref(localStorage.getItem('vim-highlight-yank') !== 'false')
  const vimClipboardSync = ref(localStorage.getItem('vim-clipboard-sync') !== 'false')

  function togglePreview() {
    previewVisible.value = !previewVisible.value
    localStorage.setItem('preview-visible', String(previewVisible.value))
  }

  function setPreviewFontSize(size: number) {
    previewFontSize.value = clampFontSize(size)
    localStorage.setItem('preview-font-size', String(previewFontSize.value))
  }

  function setEditorFontSize(size: number) {
    editorFontSize.value = clampFontSize(size)
    localStorage.setItem('editor-font-size', String(editorFontSize.value))
  }

  function setVimEnabled(val: boolean) {
    vimEnabled.value = val
    localStorage.setItem('vim-enabled', String(val))
  }

  function setVimEscTimeout(val: number) {
    vimEscTimeout.value = val
    localStorage.setItem('vim-esc-timeout', String(val))
  }

  function setHighlightOnYank(val: boolean) {
    highlightOnYank.value = val
    localStorage.setItem('vim-highlight-yank', String(val))
  }

  function setVimClipboardSync(val: boolean) {
    vimClipboardSync.value = val
    localStorage.setItem('vim-clipboard-sync', String(val))
  }

  function addVimMapping(m: Omit<VimMapping, 'id'>) {
    const mapping: VimMapping = { ...m, id: crypto.randomUUID() }
    vimMappings.value = [...vimMappings.value, mapping]
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
  }

  function removeVimMapping(id: string) {
    vimMappings.value = vimMappings.value.filter((m) => m.id !== id)
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
  }

  function updateVimMapping(id: string, patch: Partial<Omit<VimMapping, 'id'>>) {
    vimMappings.value = vimMappings.value.map((m) => (m.id === id ? { ...m, ...patch } : m))
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
  }

  return {
    previewVisible,
    previewFontSize,
    editorFontSize,
    vimEnabled,
    vimEscTimeout,
    vimMappings,
    highlightOnYank,
    vimClipboardSync,
    togglePreview,
    setPreviewFontSize,
    setEditorFontSize,
    setVimEnabled,
    setVimEscTimeout,
    setHighlightOnYank,
    setVimClipboardSync,
    addVimMapping,
    removeVimMapping,
    updateVimMapping,
  }
})
