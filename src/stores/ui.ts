import { defineStore } from 'pinia'
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

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

export type SidebarTab = 'files' | 'images'

export const useUiStore = defineStore('ui', () => {
  const sidebarTab = ref<SidebarTab>('files')
  const highlightedImageId = ref<string | null>(null)

  function navigateToImage(entryId: string) {
    sidebarTab.value = 'images'
    highlightedImageId.value = entryId
    // Clear highlight after animation
    setTimeout(() => {
      highlightedImageId.value = null
    }, 1500)
  }

  const previewVisible = ref(localStorage.getItem('preview-visible') !== 'false')
  const previewFontSize = ref(readFontSize('preview-font-size', 15))
  const editorFontSize = ref(readFontSize('editor-font-size', 13))
  const isDarkMode = ref(localStorage.getItem('theme') === 'dark')
  const vimEnabled = ref(localStorage.getItem('vim-enabled') !== 'false')
  const vimEscTimeout = ref(readVimEscTimeout())
  const vimMappings = ref<VimMapping[]>(readVimMappings())
  const highlightOnYank = ref(localStorage.getItem('vim-highlight-yank') !== 'false')
  const vimClipboardSync = ref(localStorage.getItem('vim-clipboard-sync') !== 'false')

  // ── Supabase sync ─────────────────────────────────────────────────────────

  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function serializeSettings(): Record<string, unknown> {
    return {
      theme: isDarkMode.value ? 'dark' : 'light',
      previewVisible: previewVisible.value,
      previewFontSize: previewFontSize.value,
      editorFontSize: editorFontSize.value,
      vimEnabled: vimEnabled.value,
      vimEscTimeout: vimEscTimeout.value,
      vimMappings: vimMappings.value,
      highlightOnYank: highlightOnYank.value,
      vimClipboardSync: vimClipboardSync.value,
    }
  }

  function saveSettings(userId: string) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      supabase
        .from('user_settings')
        .upsert({ user_id: userId, settings: serializeSettings(), updated_at: new Date().toISOString() })
        .then()
    }, 1000)
  }

  async function loadSettings(userId: string) {
    const { data } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single()

    if (!data) {
      // First login — persist current localStorage values to Supabase
      await supabase
        .from('user_settings')
        .upsert({ user_id: userId, settings: serializeSettings() })
      return
    }

    const s = data.settings

    if (s.theme === 'dark' || s.theme === 'light') {
      isDarkMode.value = s.theme === 'dark'
      document.documentElement.classList.toggle('dark', isDarkMode.value)
      localStorage.setItem('theme', s.theme as string)
    }
    if (typeof s.previewVisible === 'boolean') {
      previewVisible.value = s.previewVisible
      localStorage.setItem('preview-visible', String(s.previewVisible))
    }
    if (typeof s.previewFontSize === 'number') {
      previewFontSize.value = clampFontSize(s.previewFontSize)
      localStorage.setItem('preview-font-size', String(previewFontSize.value))
    }
    if (typeof s.editorFontSize === 'number') {
      editorFontSize.value = clampFontSize(s.editorFontSize)
      localStorage.setItem('editor-font-size', String(editorFontSize.value))
    }
    if (typeof s.vimEnabled === 'boolean') {
      vimEnabled.value = s.vimEnabled
      localStorage.setItem('vim-enabled', String(s.vimEnabled))
    }
    if (typeof s.vimEscTimeout === 'number') {
      vimEscTimeout.value = s.vimEscTimeout
      localStorage.setItem('vim-esc-timeout', String(s.vimEscTimeout))
    }
    if (Array.isArray(s.vimMappings)) {
      vimMappings.value = s.vimMappings as VimMapping[]
      localStorage.setItem('vim-mappings', JSON.stringify(s.vimMappings))
    }
    if (typeof s.highlightOnYank === 'boolean') {
      highlightOnYank.value = s.highlightOnYank
      localStorage.setItem('vim-highlight-yank', String(s.highlightOnYank))
    }
    if (typeof s.vimClipboardSync === 'boolean') {
      vimClipboardSync.value = s.vimClipboardSync
      localStorage.setItem('vim-clipboard-sync', String(s.vimClipboardSync))
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function toggleDarkMode(userId?: string) {
    isDarkMode.value = !isDarkMode.value
    document.documentElement.classList.toggle('dark', isDarkMode.value)
    localStorage.setItem('theme', isDarkMode.value ? 'dark' : 'light')
    if (userId) saveSettings(userId)
  }

  function togglePreview() {
    previewVisible.value = !previewVisible.value
    localStorage.setItem('preview-visible', String(previewVisible.value))
  }

  function setPreviewFontSize(size: number, userId?: string) {
    previewFontSize.value = clampFontSize(size)
    localStorage.setItem('preview-font-size', String(previewFontSize.value))
    if (userId) saveSettings(userId)
  }

  function setEditorFontSize(size: number, userId?: string) {
    editorFontSize.value = clampFontSize(size)
    localStorage.setItem('editor-font-size', String(editorFontSize.value))
    if (userId) saveSettings(userId)
  }

  function setVimEnabled(val: boolean, userId?: string) {
    vimEnabled.value = val
    localStorage.setItem('vim-enabled', String(val))
    if (userId) saveSettings(userId)
  }

  function setVimEscTimeout(val: number, userId?: string) {
    vimEscTimeout.value = val
    localStorage.setItem('vim-esc-timeout', String(val))
    if (userId) saveSettings(userId)
  }

  function setHighlightOnYank(val: boolean, userId?: string) {
    highlightOnYank.value = val
    localStorage.setItem('vim-highlight-yank', String(val))
    if (userId) saveSettings(userId)
  }

  function setVimClipboardSync(val: boolean, userId?: string) {
    vimClipboardSync.value = val
    localStorage.setItem('vim-clipboard-sync', String(val))
    if (userId) saveSettings(userId)
  }

  function addVimMapping(m: Omit<VimMapping, 'id'>, userId?: string) {
    const mapping: VimMapping = { ...m, id: crypto.randomUUID() }
    vimMappings.value = [...vimMappings.value, mapping]
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
    if (userId) saveSettings(userId)
  }

  function removeVimMapping(id: string, userId?: string) {
    vimMappings.value = vimMappings.value.filter((m) => m.id !== id)
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
    if (userId) saveSettings(userId)
  }

  function updateVimMapping(id: string, patch: Partial<Omit<VimMapping, 'id'>>, userId?: string) {
    vimMappings.value = vimMappings.value.map((m) => (m.id === id ? { ...m, ...patch } : m))
    localStorage.setItem('vim-mappings', JSON.stringify(vimMappings.value))
    if (userId) saveSettings(userId)
  }

  return {
    sidebarTab,
    highlightedImageId,
    navigateToImage,
    previewVisible,
    previewFontSize,
    editorFontSize,
    isDarkMode,
    vimEnabled,
    vimEscTimeout,
    vimMappings,
    highlightOnYank,
    vimClipboardSync,
    loadSettings,
    toggleDarkMode,
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
