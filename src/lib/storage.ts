import { ref, watch, type Ref } from 'vue'

/**
 * Single source of truth for every localStorage key the app uses.
 * Keep these in sync with the inline theme bootstrap in `index.html`.
 */
export const STORAGE_KEYS = {
  theme: 'theme',
  previewVisible: 'preview-visible',
  previewFontSize: 'preview-font-size',
  editorFontSize: 'editor-font-size',
  vimEnabled: 'vim-enabled',
  vimEscTimeout: 'vim-esc-timeout',
  vimMappings: 'vim-mappings',
  highlightOnYank: 'vim-highlight-yank',
  vimClipboardSync: 'vim-clipboard-sync',
} as const

/**
 * Converts a value to/from its localStorage string representation.
 * `read` receives the raw stored string (or `null` when absent) plus the
 * fallback to use when the value is missing or unparseable.
 */
export interface Codec<T> {
  read(raw: string | null, fallback: T): T
  write(value: T): string
}

/**
 * Boolean stored as `'true'`/`'false'`. A missing value yields the fallback,
 * so a `true` default is only overridden by an explicit `'false'`.
 */
export const boolCodec: Codec<boolean> = {
  read: (raw, fallback) => (raw === null ? fallback : raw === 'true'),
  write: (value) => String(value),
}

/** Theme stored as `'dark'`/`'light'`, surfaced as an `isDark` boolean. */
export const themeCodec: Codec<boolean> = {
  read: (raw, fallback) => (raw === null ? fallback : raw === 'dark'),
  write: (value) => (value ? 'dark' : 'light'),
}

/** Integer clamped to `[min, max]` on both read and write. */
export function clampedIntCodec(min: number, max: number): Codec<number> {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return {
    read: (raw, fallback) => {
      if (raw === null) return fallback
      const n = parseInt(raw, 10)
      return isNaN(n) ? fallback : clamp(n)
    },
    write: (value) => String(clamp(value)),
  }
}

/** Plain integer; falls back when missing or unparseable. */
export const intCodec: Codec<number> = {
  read: (raw, fallback) => {
    if (raw === null) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) ? fallback : n
  },
  write: (value) => String(value),
}

/** JSON-serialized value; returns the fallback on any parse failure. */
export function jsonCodec<T>(): Codec<T> {
  return {
    read: (raw, fallback) => {
      if (!raw) return fallback
      try {
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    write: (value) => JSON.stringify(value),
  }
}

/**
 * A `ref` hydrated from localStorage that persists itself back on every change.
 * Centralizes read-on-init and write-on-change so each setting is defined once.
 */
export function persisted<T>(key: string, fallback: T, codec: Codec<T>): Ref<T> {
  const state = ref(codec.read(localStorage.getItem(key), fallback)) as Ref<T>
  watch(state, (value) => localStorage.setItem(key, codec.write(value)))
  return state
}
