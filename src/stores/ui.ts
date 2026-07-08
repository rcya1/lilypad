// Pinia store for UI settings (dark mode, font sizes, Vim config) persisted to localStorage and synced to Supabase.
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

// Font size bounds applied both on set and on hydrate from the cloud,
// so out-of-range values from old storage are silently clamped.
const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24
// How long to wait after the last setting change before flushing to Supabase.
// Avoids a network round-trip on every slider tick.
const REMOTE_SAVE_DEBOUNCE_MS = 1000

/** A single user-defined Vim key mapping (e.g. jk → <Esc> in insert mode). */
export interface VimMapping {
  id: string
  /** Left-hand side: the key sequence to remap. */
  lhs: string
  /** Right-hand side: the keys to execute. */
  rhs: string
  mode: 'normal' | 'insert' | 'visual'
  /** When true, the mapping is non-recursive (noremap / nnoremap / etc.). */
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

  /**
   * Switches the sidebar to the Images tab and briefly highlights the given image entry.
   * The highlight is cleared after 1.5 s (long enough for a CSS flash animation).
   */
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

  // ── Persisted settings ──────────────────────────────────────────────────────
  // Each `persisted()` call creates a Vue ref that is pre-hydrated from localStorage
  // and written back automatically on every change. Cloud sync is wired up separately
  // via `syncRemote` below — the two layers are independent.
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

  // Apply dark mode to <html class="dark"> whenever the setting changes, including
  // the initial load (immediate: true) and after cloud hydration overwrites the value.
  watch(isDarkMode, (v) => document.documentElement.classList.toggle('dark', v), {
    immediate: true,
  })

  // ── Supabase sync ───────────────────────────────────────────────────────────
  /**
   * Descriptor for a setting that participates in Supabase cloud sync.
   * `encode` serialises the current value for upsert; `decode` applies a remote value
   * (returning undefined signals an invalid/missing value that should be skipped).
   */
  interface RemoteSetting {
    key: string
    encode: () => unknown
    decode: (raw: unknown) => void
  }

  // Registry of all settings that should be round-tripped with Supabase.
  const remoteSettings: RemoteSetting[] = []

  /**
   * Registers a setting ref for Supabase sync.
   *
   * @param state   - The reactive ref to keep in sync.
   * @param key     - Column key inside the `user_settings.settings` JSONB object.
   * @param decode  - Validates and converts the raw cloud value. Return `undefined` to skip.
   * @param encode  - Converts the ref value to a JSON-serialisable form (identity by default).
   */
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

  // Register every persisted setting for cloud sync.
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

  /** Serialises every registered remote setting into a plain object for upsert. */
  function serializeSettings(): Record<string, unknown> {
    return Object.fromEntries(remoteSettings.map((s) => [s.key, s.encode()]))
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  // True while loadSettings() is applying cloud values — used to suppress echo-saves
  // that would otherwise fire because the watchers below see the hydration writes.
  let hydrating = false

  /**
   * Debounces a Supabase upsert of all current settings.
   * Guards are in place so this is a no-op when:
   *   - The user is not logged in (no userId).
   *   - We are currently hydrating from the cloud (prevents echo-save loops).
   */
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
        .then()
    }, REMOTE_SAVE_DEBOUNCE_MS)
  }

  // Watch all persisted settings and schedule a Supabase save on any change.
  // `flush: 'sync'` ensures the `hydrating` flag is still set when these watchers
  // fire during loadSettings() — using the default 'pre' flush would defer the
  // watcher to the next microtask, after `hydrating` has already been cleared.
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

  /**
   * Fetches the user's settings from Supabase and applies them over localStorage values.
   * Cloud values win on conflict (last-write on any device wins).
   *
   * On first login (no row exists yet), the current local values are persisted to Supabase
   * so subsequent logins on other devices pick up the defaults the user has already configured.
   *
   * @param userId - The authenticated Supabase user ID.
   */
  async function loadSettings(userId: string) {
    const { data, error } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', userId)
      .single()

    // PGRST116 = zero rows for .single() — the only case that means "first login".
    // Any other error is transient/unknown: bail without seeding, so a network blip
    // can't overwrite the user's cloud settings with this device's local values.
    if (error && error.code !== 'PGRST116') {
      console.error('loadSettings failed:', error)
      return
    }

    if (!data) {
      // First login — seed Supabase with whatever is already in localStorage.
      await supabase
        .from('user_settings')
        .upsert({ user_id: userId, settings: serializeSettings() })
      return
    }

    const remote = data.settings as Record<string, unknown>
    // The `hydrating` flag suppresses the scheduleSave watcher during this block.
    hydrating = true
    for (const setting of remoteSettings) setting.decode(remote[setting.key])
    hydrating = false
  }

  // ── Setters ─────────────────────────────────────────────────────────────────
  // Mutating the refs is all that's needed — localStorage sync is handled by
  // `persisted()` and Supabase sync is handled by the watcher above.

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

  /**
   * Appends a new Vim key mapping. Replaces the array (rather than mutating in place)
   * so Vue's reactivity system detects the change.
   */
  function addVimMapping(m: Omit<VimMapping, 'id'>) {
    vimMappings.value = [...vimMappings.value, { ...m, id: crypto.randomUUID() }]
  }

  /** Removes the mapping with the given ID. */
  function removeVimMapping(id: string) {
    vimMappings.value = vimMappings.value.filter((m) => m.id !== id)
  }

  /** Applies a partial update to an existing mapping, identified by ID. */
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
