import { defineStore } from 'pinia'
import { ref, watch, type Ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import {
  STORAGE_KEYS,
  persisted,
  boolCodec,
  themeCodec,
  intCodec,
  clampedIntCodec,
  jsonCodec,
} from '@/lib/storage'

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24
const REMOTE_SAVE_DEBOUNCE_MS = 1000

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

export type SidebarTab = 'files' | 'images'

export const useUiStore = defineStore('ui', () => {
  // ── Ephemeral UI state (not persisted) ──────────────────────────────────────
  const sidebarTab = ref<SidebarTab>('files')
  const highlightedImageId = ref<string | null>(null)
  const quickSwitcherOpen = ref(false)

  function navigateToImage(entryId: string) {
    sidebarTab.value = 'images'
    highlightedImageId.value = entryId
    // Clear highlight after animation
    setTimeout(() => {
      highlightedImageId.value = null
    }, 1500)
  }

  function openQuickSwitcher() {
    quickSwitcherOpen.value = true
  }

  function closeQuickSwitcher() {
    quickSwitcherOpen.value = false
  }

  // ── Persisted settings ──────────────────────────────────────────────────────
  // Each setting is declared once: `persisted` hydrates it from localStorage and
  // writes it back on every change. Cloud sync is wired up separately below.
  const isDarkMode = persisted(STORAGE_KEYS.theme, false, themeCodec)
  const previewVisible = persisted(STORAGE_KEYS.previewVisible, true, boolCodec)
  const previewFontSize = persisted(
    STORAGE_KEYS.previewFontSize,
    15,
    clampedIntCodec(FONT_SIZE_MIN, FONT_SIZE_MAX),
  )
  const editorFontSize = persisted(
    STORAGE_KEYS.editorFontSize,
    13,
    clampedIntCodec(FONT_SIZE_MIN, FONT_SIZE_MAX),
  )
  const vimEnabled = persisted(STORAGE_KEYS.vimEnabled, true, boolCodec)
  const vimEscTimeout = persisted(STORAGE_KEYS.vimEscTimeout, 200, intCodec)
  const vimMappings = persisted<VimMapping[]>(
    STORAGE_KEYS.vimMappings,
    [],
    jsonCodec<VimMapping[]>(),
  )
  const highlightOnYank = persisted(STORAGE_KEYS.highlightOnYank, true, boolCodec)
  const vimClipboardSync = persisted(STORAGE_KEYS.vimClipboardSync, true, boolCodec)

  // Reflect dark mode onto <html> — covers initial load, toggle, and cloud hydrate.
  watch(isDarkMode, (v) => document.documentElement.classList.toggle('dark', v), {
    immediate: true,
  })

  // ── Supabase sync ───────────────────────────────────────────────────────────
  // A registry mapping each setting ref to its Supabase field. `decode` returns
  // `undefined` for missing/invalid remote values so they're skipped on hydrate.
  interface RemoteSetting {
    key: string
    encode: () => unknown
    decode: (raw: unknown) => void
  }

  const remoteSettings: RemoteSetting[] = []

  function syncRemote<T>(
    state: Ref<T>,
    key: string,
    decode: (raw: unknown) => T | undefined,
    encode: (value: T) => unknown = (value) => value,
  ) {
    remoteSettings.push({
      key,
      encode: () => encode(state.value),
      decode: (raw) => {
        const value = decode(raw)
        if (value !== undefined) state.value = value
      },
    })
  }

  syncRemote(
    isDarkMode,
    'theme',
    (raw) => (raw === 'dark' || raw === 'light' ? raw === 'dark' : undefined),
    (value) => (value ? 'dark' : 'light'),
  )
  syncRemote(previewVisible, 'previewVisible', (raw) =>
    typeof raw === 'boolean' ? raw : undefined,
  )
  syncRemote(previewFontSize, 'previewFontSize', (raw) =>
    typeof raw === 'number' ? clampFontSize(raw) : undefined,
  )
  syncRemote(editorFontSize, 'editorFontSize', (raw) =>
    typeof raw === 'number' ? clampFontSize(raw) : undefined,
  )
  syncRemote(vimEnabled, 'vimEnabled', (raw) => (typeof raw === 'boolean' ? raw : undefined))
  syncRemote(vimEscTimeout, 'vimEscTimeout', (raw) => (typeof raw === 'number' ? raw : undefined))
  syncRemote(vimMappings, 'vimMappings', (raw) =>
    Array.isArray(raw) ? (raw as VimMapping[]) : undefined,
  )
  syncRemote(highlightOnYank, 'highlightOnYank', (raw) =>
    typeof raw === 'boolean' ? raw : undefined,
  )
  syncRemote(vimClipboardSync, 'vimClipboardSync', (raw) =>
    typeof raw === 'boolean' ? raw : undefined,
  )

  function serializeSettings(): Record<string, unknown> {
    return Object.fromEntries(remoteSettings.map((s) => [s.key, s.encode()]))
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let hydrating = false

  function scheduleSave() {
    // Skip echo-saves while applying values fetched from the cloud.
    if (hydrating) return
    const userId = useAuthStore().user?.id
    if (!userId) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          settings: serializeSettings(),
          updated_at: new Date().toISOString(),
        })
        .then()
    }, REMOTE_SAVE_DEBOUNCE_MS)
  }

  // Sync flush so the `hydrating` guard reliably wraps cloud-applied changes.
  watch(
    [
      isDarkMode,
      previewVisible,
      previewFontSize,
      editorFontSize,
      vimEnabled,
      vimEscTimeout,
      vimMappings,
      highlightOnYank,
      vimClipboardSync,
    ],
    scheduleSave,
    { flush: 'sync' },
  )

  async function loadSettings(userId: string) {
    const { data } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single()

    if (!data) {
      // First login — persist current local values to Supabase.
      await supabase
        .from('user_settings')
        .upsert({ user_id: userId, settings: serializeSettings() })
      return
    }

    const remote = data.settings as Record<string, unknown>
    hydrating = true
    for (const setting of remoteSettings) setting.decode(remote[setting.key])
    hydrating = false
  }

  // ── Setters ─────────────────────────────────────────────────────────────────
  // Persistence (localStorage + Supabase) is handled by the watchers above, so
  // these only need to mutate the ref.

  function toggleDarkMode() {
    isDarkMode.value = !isDarkMode.value
  }

  function togglePreview() {
    previewVisible.value = !previewVisible.value
  }

  function setPreviewFontSize(size: number) {
    previewFontSize.value = clampFontSize(size)
  }

  function setEditorFontSize(size: number) {
    editorFontSize.value = clampFontSize(size)
  }

  function setVimEnabled(val: boolean) {
    vimEnabled.value = val
  }

  function setVimEscTimeout(val: number) {
    vimEscTimeout.value = val
  }

  function setHighlightOnYank(val: boolean) {
    highlightOnYank.value = val
  }

  function setVimClipboardSync(val: boolean) {
    vimClipboardSync.value = val
  }

  function addVimMapping(m: Omit<VimMapping, 'id'>) {
    vimMappings.value = [...vimMappings.value, { ...m, id: crypto.randomUUID() }]
  }

  function removeVimMapping(id: string) {
    vimMappings.value = vimMappings.value.filter((m) => m.id !== id)
  }

  function updateVimMapping(id: string, patch: Partial<Omit<VimMapping, 'id'>>) {
    vimMappings.value = vimMappings.value.map((m) => (m.id === id ? { ...m, ...patch } : m))
  }

  return {
    sidebarTab,
    highlightedImageId,
    navigateToImage,
    quickSwitcherOpen,
    openQuickSwitcher,
    closeQuickSwitcher,
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
