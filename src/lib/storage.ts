// Typed localStorage codecs and `persisted()` refs.
import { ref, watch, type Ref } from 'vue'

/** Every localStorage key. `theme` must match the pre-paint bootstrap in index.html. */
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

/** `read` gets the stored string (null if absent) and the fallback for missing or bad values. */
export interface Codec<T> {
  read(raw: string | null, fallback: T): T
  write(value: T): string
}

/** A missing value gives the fallback, so a `true` default only yields to an explicit 'false'. */
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

export const intCodec: Codec<number> = {
  read: (raw, fallback) => {
    if (raw === null) return fallback
    const n = parseInt(raw, 10)
    return isNaN(n) ? fallback : n
  },
  write: (value) => String(value),
}

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

/** Hydrated from localStorage and written back on every change. */
export function persisted<T>(key: string, fallback: T, codec: Codec<T>): Ref<T> {
  const state = ref(codec.read(localStorage.getItem(key), fallback)) as Ref<T>
  watch(state, (value) => localStorage.setItem(key, codec.write(value)))
  return state
}
