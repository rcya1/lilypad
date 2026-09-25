// Pinia store for UI state and settings (theme, font sizes, Vim), saved locally and to Supabase.
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

// Applied when setting and when loading from the cloud, so old out-of-range values are clamped.
const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24
// Batches setting changes (e.g. slider drags) into one upsert.
const REMOTE_SAVE_DEBOUNCE_MS = 1000

/** e.g. jk → <Esc> in insert mode. */
export interface VimMapping {
  id: string
  lhs: string
  rhs: string
  mode: 'normal' | 'insert' | 'visual'
  /** Non-recursive (noremap). */
  noremap: boolean
}

function clampFontSize(n: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))
}

export type SidebarTab = 'files' | 'images'

export type ModeSwitchDirection = 'to-read' | 'to-edit'
// How long after a Read/Edit flip the arriving screen counts as "just switched".
const MODE_SWITCH_WINDOW_MS = 1000

export const useUiStore = defineStore('ui', () => {
  // Not persisted:
  const sidebarTab = ref<SidebarTab>('files')
  const highlightedImageId = ref<string | null>(null)
  const quickSwitcherOpen = ref(false)
  // Shared by the editor and reader sidebars so flipping Read/Edit doesn't move or resize them, or
  // reset the tree's scroll.
  const sidebarWidth = ref(250)
  const sidebarMinimized = ref(false)
  const sidebarScrollTop = ref(0)
  const sidebarResizing = ref(false)
  // Set by the Read/Edit switch before navigating; components on the arriving screen check it in
  // setup to play their entry animations. Timestamped rather than cleared on read so several
  // components can see it.
  const modeSwitch = ref<{ direction: ModeSwitchDirection; at: number } | null>(null)

  function markModeSwitch(direction: ModeSwitchDirection) {
    modeSwitch.value = { direction, at: performance.now() }
  }

  /** Also false when the user prefers reduced motion. */
  function arrivedViaModeSwitch(direction: ModeSwitchDirection): boolean {
    const flip = modeSwitch.value
    return (
      !!flip &&
      flip.direction === direction &&
      performance.now() - flip.at < MODE_SWITCH_WINDOW_MS &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }

  /** Opens the Images tab with the image highlighted for 1.5s (the flash animation). */
  function navigateToImage(entryId: string) {
    sidebarTab.value = 'images'
    highlightedImageId.value = entryId
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

  // Persisted: each `persisted()` ref hydrates from localStorage and writes back on change. Cloud
  // sync is separate (syncRemote below).
  const isDarkMode = persisted(STORAGE_KEYS.theme, false, themeCodec)
  const previewVisible = persisted(STORAGE_KEYS.previewVisible, true, boolCodec)
  const previewFontSize = persisted(
    STORAGE_KEYS.previewFontSize,
    13,
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

  watch(isDarkMode, (v) => document.documentElement.classList.toggle('dark', v), {
    immediate: true,
  })

  interface RemoteSetting {
    key: string
    encode: () => unknown
    decode: (raw: unknown) => void
  }

  const remoteSettings: RemoteSetting[] = []

  /** `key` is the field in `user_settings.settings`; `decode` returns undefined to skip a value. */
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
  // Set while loadSettings() applies cloud values, so those writes don't echo back as saves.
  let hydrating = false

  /** Debounced upsert of every setting. */
  function scheduleSave() {
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
        .then(({ error }) => {
          if (error) console.error('settings save failed:', error)
        })
    }, REMOTE_SAVE_DEBOUNCE_MS)
  }

  // flush: 'sync' so these run while `hydrating` is still set during loadSettings().
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

  /** Cloud values win over local ones. On first login (no row yet), this device's are uploaded. */
  async function loadSettings(userId: string) {
    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single()

    // PGRST116 (no row) is the only "first login" case. Bail on anything else, so a network blip
    // can't overwrite the cloud settings with this device's.
    if (error && error.code !== 'PGRST116') {
      console.error('loadSettings failed:', error)
      return
    }

    if (!data) {
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
    sidebarWidth,
    sidebarMinimized,
    sidebarScrollTop,
    sidebarResizing,
    markModeSwitch,
    arrivedViaModeSwitch,
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
