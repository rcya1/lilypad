<script lang="ts">
let vimExRegistered = false
// Module-level tracking of applied mappings so any instance can unmap before re-mapping
let appliedMappings: Array<{ lhs: string; mode: string }> = []

// ---------------------------------------------------------------------------
// Image upload — module-level state (shared across all editor instances)
// ---------------------------------------------------------------------------
interface UploadedImageResult {
  entryId: string
  storagePath: string
  publicUrl: string
}

/** In-flight uploads keyed by sentinel UUID. */
const detachedUploads = new Map<string, { promise: Promise<UploadedImageResult> }>()

/** Completed uploads stashed while the view was on a different tab. */
const completedUploads = new Map<string, UploadedImageResult>()

/** Failed uploads stashed while the view was on a different tab. */
const failedUploads = new Set<string>()

const sentinelPattern = /<!--uploading:[a-f0-9-]+-->/g
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, StateEffect, StateField, Compartment, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, keymap, WidgetType, type Command } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { search, searchKeymap } from '@codemirror/search'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useToastStore } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'

const highlightLineEffect = StateEffect.define<number | null>()

const highlightLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(highlightLineEffect)) {
        if (effect.value == null) return Decoration.none
        const line = tr.state.doc.line(effect.value)
        return Decoration.set([Decoration.line({ class: 'cm-highlight-line' }).range(line.from)])
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

const yankFlashEffect = StateEffect.define<{ from: number; to: number } | null>()

const yankFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes)
    for (const effect of tr.effects) {
      if (effect.is(yankFlashEffect)) {
        if (effect.value == null) return Decoration.none
        const { from, to } = effect.value
        if (from >= to) return Decoration.none
        return Decoration.set([Decoration.mark({ class: 'cm-yank-flash' }).range(from, to)])
      }
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ---------------------------------------------------------------------------
// Upload spinner widget — shown in place of sentinel text
// ---------------------------------------------------------------------------
class UploadSpinnerWidget extends WidgetType {
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-upload-spinner'
    wrap.setAttribute('contenteditable', 'false')
    const spinner = document.createElement('span')
    spinner.className = 'cm-upload-spinner-icon'
    wrap.appendChild(spinner)
    const label = document.createElement('span')
    label.className = 'cm-upload-spinner-label'
    label.textContent = 'Uploading image…'
    wrap.appendChild(label)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

function buildUploadDecorations(state: EditorState): DecorationSet {
  const builder: Range<Decoration>[] = []
  const doc = state.doc.toString()
  sentinelPattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = sentinelPattern.exec(doc)) !== null) {
    builder.push(
      Decoration.replace({ widget: new UploadSpinnerWidget() }).range(
        match.index,
        match.index + match[0].length,
      ),
    )
  }
  return Decoration.set(builder, true)
}

const uploadWidgetField = StateField.define<DecorationSet>({
  create(state) {
    return buildUploadDecorations(state)
  },
  update(decos, tr) {
    if (tr.docChanged) return buildUploadDecorations(tr.state)
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

// Transaction filter: any edit that partially overlaps a sentinel expands to delete the whole thing
const sentinelGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const doc = tr.startState.doc.toString()
  const sentinels: { from: number; to: number }[] = []
  sentinelPattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = sentinelPattern.exec(doc)) !== null) {
    const end = m.index + m[0].length
    const hasTrailingNewline = end < doc.length && doc[end] === '\n'
    sentinels.push({ from: m.index, to: hasTrailingNewline ? end + 1 : end })
  }

  if (sentinels.length === 0) return tr

  let needsExpansion = false
  const expandedChanges: { from: number; to: number; insert: string }[] = []

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    let from = fromA
    let to = toA
    for (const s of sentinels) {
      const overlaps = from < s.to && to > s.from
      if (overlaps) {
        from = Math.min(from, s.from)
        to = Math.max(to, s.to)
        needsExpansion = true
      }
    }
    expandedChanges.push({ from, to, insert: inserted.toString() })
  })

  if (!needsExpansion) return tr

  return [{ changes: expandedChanges }]
})

// ---------------------------------------------------------------------------
// Ghost text widget — shows image entry name after img: references
// ---------------------------------------------------------------------------
class GhostNameWidget extends WidgetType {
  constructor(private name: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-ghost-name'
    span.textContent = ` ${this.name}`
    return span
  }

  eq(other: GhostNameWidget) {
    return this.name === other.name
  }

  ignoreEvent() {
    return true
  }
}

class RenameAnchorWidget extends WidgetType {
  constructor(private id: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-rename-anchor'
    span.dataset.renameAnchor = this.id
    return span
  }

  eq(other: RenameAnchorWidget) {
    return this.id === other.id
  }

  ignoreEvent() {
    return true
  }
}

const imgRefPattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g

const props = defineProps<{ documentId: string; isActive: boolean }>()

const store = useEditorStore()
const filesStore = useFilesStore()
const toastStore = useToastStore()
const uiStore = useUiStore()

const renamingImageId = ref<string | null>(null)
const renamingImageExt = ref<string>('')

function buildGhostDecorations(state: EditorState): DecorationSet {
  const builder: Range<Decoration>[] = []
  const doc = state.doc.toString()
  imgRefPattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = imgRefPattern.exec(doc)) !== null) {
    const entryId = match[1]!
    const entry = filesStore.getEntry(entryId)
    if (entry) {
      const pos = match.index + match[0].length
      if (renamingImageId.value === entryId) {
        builder.push(
          Decoration.widget({
            widget: new RenameAnchorWidget(entryId),
            side: 1,
          }).range(pos),
        )
      } else {
        builder.push(
          Decoration.widget({
            widget: new GhostNameWidget(entry.name),
            side: 1,
          }).range(pos),
        )
      }
    }
  }
  return Decoration.set(builder, true)
}

const rebuildGhostEffect = StateEffect.define<null>()

const imgGhostNameField = StateField.define<DecorationSet>({
  create(state) {
    return buildGhostDecorations(state)
  },
  update(decos, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(rebuildGhostEffect))) {
      return buildGhostDecorations(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

function rebuildGhosts() {
  view?.dispatch({ effects: rebuildGhostEffect.of(null) })
}
const indentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from)
    if (seenLines.has(line.number)) continue
    if (!/^\s*-\s/.test(line.text)) return false
    seenLines.add(line.number)
    changes.push({ from: line.from, insert: '  ' })
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}

const dedentBullet: Command = (editorView) => {
  const { state } = editorView
  const seenLines = new Set<number>()
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from)
    if (seenLines.has(line.number)) continue
    if (!/^\s*-\s/.test(line.text)) return false
    if (!line.text.startsWith('  ')) return false
    seenLines.add(line.number)
    changes.push({ from: line.from, to: line.from + 2, insert: '' })
  }
  if (changes.length === 0) return false
  editorView.dispatch(state.update({ changes, scrollIntoView: true }))
  return true
}

const container = ref<HTMLDivElement>()
let view: EditorView | null = null
let highlightTimer: ReturnType<typeof setTimeout> | undefined
let yankFlashTimer: ReturnType<typeof setTimeout> | undefined
const fontSizeCompartment = new Compartment()
const vimCompartment = new Compartment()

const vimMode = ref<'normal' | 'insert' | 'visual' | 'replace'>('normal')

const modeLabel = computed(() => {
  switch (vimMode.value) {
    case 'insert':
      return '-- INSERT --'
    case 'visual':
      return '-- VISUAL --'
    case 'replace':
      return '-- REPLACE --'
    default:
      return ''
  }
})

const modeLabelClass = computed(() => {
  switch (vimMode.value) {
    case 'insert':
      return 'text-accent'
    case 'visual':
      return 'text-amber'
    case 'replace':
      return 'text-text-secondary'
    default:
      return ''
  }
})

function applyVimSettings() {
  for (const m of appliedMappings) {
    try {
      Vim.unmap(m.lhs, m.mode)
    } catch {}
  }
  appliedMappings = []

  Vim.setOption('insertModeEscKeysTimeout', uiStore.vimEscTimeout)

  for (const m of uiStore.vimMappings) {
    if (!m.lhs || !m.rhs) continue
    try {
      if (m.noremap) {
        Vim.noremap(m.lhs, m.rhs, m.mode)
      } else {
        Vim.map(m.lhs, m.rhs, m.mode)
      }
      appliedMappings.push({ lhs: m.lhs, mode: m.mode })
    } catch {}
  }
}

function flashYankRange(from: number, to: number) {
  if (!view) return
  if (yankFlashTimer) clearTimeout(yankFlashTimer)
  view.dispatch({ effects: yankFlashEffect.of({ from, to }) })
  yankFlashTimer = setTimeout(() => {
    view?.dispatch({ effects: yankFlashEffect.of(null) })
    yankFlashTimer = undefined
  }, 350)
}

function handleYank(from: number, to: number, lineType = false) {
  if (!view) return
  if (uiStore.highlightOnYank) flashYankRange(from, to)
  if (uiStore.vimClipboardSync && uiStore.vimEnabled) {
    const text = lineType
      ? view.state.doc.sliceString(from, to) + '\n'
      : view.state.doc.sliceString(from, to)
    navigator.clipboard.writeText(text).catch(() => {})
  }
}

function syncClipboardToVimRegister() {
  if (!uiStore.vimClipboardSync || !uiStore.vimEnabled || !view) return
  navigator.clipboard
    .readText()
    .then((text) => {
      if (!text) return
      const cm = getCM(view!)
      if (cm) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(cm as any).state.vim.registers['"'] = {
            text,
            type: text.endsWith('\n') ? 'l' : 'c',
          }
        } catch {}
      }
    })
    .catch(() => {})
}

// ---------------------------------------------------------------------------
// Image paste / drop handlers
// ---------------------------------------------------------------------------

function startImageUpload(editorView: EditorView, file: File) {
  const uuid = crypto.randomUUID()
  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = editorView.state.selection.main.head

  editorView.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })

  const activeDoc = store.activeDocument
  const parentId = activeDoc ? filesStore.getParentFolderId(activeDoc.id) : null
  const promise = filesStore.uploadImage(file, parentId)
  detachedUploads.set(uuid, { promise })

  promise
    .then((result) => onUploadSuccess(editorView, uuid, result))
    .catch((err) => onUploadFailure(editorView, uuid, err))
}

function onUploadSuccess(editorView: EditorView, uuid: string, result: UploadedImageResult) {
  detachedUploads.delete(uuid)

  if (!editorView.dom.parentNode) {
    completedUploads.set(uuid, result)
    return
  }

  const sentinel = `<!--uploading:${uuid}-->`
  const doc = editorView.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx === -1) return

  const markdown = `![](img:${result.entryId})`
  const sentinelEnd = idx + sentinel.length
  const hasTrailingNewline = sentinelEnd < doc.length && doc[sentinelEnd] === '\n'
  editorView.dispatch({
    changes: {
      from: idx,
      to: hasTrailingNewline ? sentinelEnd + 1 : sentinelEnd,
      insert: markdown + '\n',
    },
  })
}

function onUploadFailure(editorView: EditorView, uuid: string, err?: unknown) {
  detachedUploads.delete(uuid)

  if (!editorView.dom.parentNode) {
    failedUploads.add(uuid)
    return
  }

  const sentinel = `<!--uploading:${uuid}-->`
  const doc = editorView.state.doc.toString()
  const idx = doc.indexOf(sentinel)

  if (idx !== -1) {
    const sentinelEnd = idx + sentinel.length
    const hasTrailingNewline = sentinelEnd < doc.length && doc[sentinelEnd] === '\n'
    editorView.dispatch({
      changes: { from: idx, to: hasTrailingNewline ? sentinelEnd + 1 : sentinelEnd, insert: '' },
    })
  }

  const detail =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message: unknown }).message)
        : ''
  const msg = detail ? `Image upload failed: ${detail}` : 'Image upload failed.'
  toastStore.addToast(msg, 'error')
}

function reinsertSentinel(editorView: EditorView, uuid: string) {
  if (!detachedUploads.has(uuid)) return
  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = editorView.state.selection.main.head
  editorView.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })
}

function resolveStashedUploads(editorView: EditorView) {
  const doc = editorView.state.doc.toString()
  sentinelPattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = sentinelPattern.exec(doc)) !== null) {
    const uuid = m[0].match(/[a-f0-9-]+/)?.[0]
    if (!uuid) continue

    if (completedUploads.has(uuid)) {
      const result = completedUploads.get(uuid)!
      completedUploads.delete(uuid)
      onUploadSuccess(editorView, uuid, result)
      return // doc changed — re-scan would need new toString()
    }

    if (failedUploads.has(uuid)) {
      failedUploads.delete(uuid)
      onUploadFailure(editorView, uuid)
      return
    }
  }
}

// ---------------------------------------------------------------------------
// Right-click rename for images
// ---------------------------------------------------------------------------
const imageContextMenu = ref<{ x: number; y: number; entryId: string } | null>(null)
const contextMenuEl = ref<HTMLDivElement | null>(null)
const imageRenamePos = ref<{ x: number; y: number } | null>(null)
const imageRenameInput = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

function closeImageContextMenu() {
  imageContextMenu.value = null
}

function startImageRename() {
  if (!imageContextMenu.value) return
  const { entryId } = imageContextMenu.value
  const entry = filesStore.getEntry(entryId)
  if (!entry) return
  const dotIdx = entry.name.lastIndexOf('.')
  renamingImageExt.value = dotIdx > 0 ? entry.name.slice(dotIdx) : ''
  const baseName = dotIdx > 0 ? entry.name.slice(0, dotIdx) : entry.name
  imageRenameInput.value = baseName
  renamingImageId.value = entryId
  closeImageContextMenu()
  rebuildGhosts()
  // Wait for anchor widget to render, then position the input over it
  nextTick(() => {
    requestAnimationFrame(() => {
      const anchor = container.value?.querySelector(`[data-rename-anchor="${entryId}"]`)
      if (anchor) {
        const rect = anchor.getBoundingClientRect()
        imageRenamePos.value = { x: rect.left, y: rect.top }
      }
      nextTick(() => {
        renameInputEl.value?.focus()
        renameInputEl.value?.select()
        // Close on any click outside the input
        setTimeout(() => {
          document.addEventListener('mousedown', onRenameClickOutside)
        }, 0)
      })
    })
  })
}

function onRenameClickOutside(e: MouseEvent) {
  if (renameInputEl.value && !renameInputEl.value.contains(e.target as Node)) {
    document.removeEventListener('mousedown', onRenameClickOutside)
    finishImageRename()
  }
}

async function finishImageRename() {
  document.removeEventListener('mousedown', onRenameClickOutside)
  const entryId = renamingImageId.value
  if (!entryId) return
  const trimmed = imageRenameInput.value.trim()
  if (trimmed) {
    await filesStore.renameEntry(entryId, trimmed + renamingImageExt.value)
  }
  renamingImageId.value = null
  renamingImageExt.value = ''
  imageRenamePos.value = null
  rebuildGhosts()
}

function cancelImageRename() {
  document.removeEventListener('mousedown', onRenameClickOutside)
  renamingImageId.value = null
  renamingImageExt.value = ''
  imageRenamePos.value = null
  rebuildGhosts()
}

function isOverImageRef(editorView: EditorView, x: number, y: number): boolean {
  const pos = editorView.posAtCoords({ x, y })
  if (pos === null) return false
  const line = editorView.state.doc.lineAt(pos)
  const imagePattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
  let match: RegExpExecArray | null
  while ((match = imagePattern.exec(line.text)) !== null) {
    const absFrom = line.from + match.index
    const absTo = absFrom + match[0].length
    if (pos >= absFrom && pos <= absTo) return true
  }
  return false
}

function updateImageCursor(editorView: EditorView, event: MouseEvent) {
  const show =
    (event.ctrlKey || event.metaKey) && isOverImageRef(editorView, event.clientX, event.clientY)
  editorView.contentDOM.style.cursor = show ? 'pointer' : ''
}

const imagePasteHandler = EditorView.domEventHandlers({
  click(event: MouseEvent, editorView: EditorView) {
    if (!(event.ctrlKey || event.metaKey)) return false
    const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    const line = editorView.state.doc.lineAt(pos)
    const imagePattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
    let match: RegExpExecArray | null
    while ((match = imagePattern.exec(line.text)) !== null) {
      const absFrom = line.from + match.index
      const absTo = absFrom + match[0].length
      if (pos >= absFrom && pos <= absTo) {
        event.preventDefault()
        uiStore.navigateToImage(match[1]!)
        return true
      }
    }
    return false
  },

  mousemove(event: MouseEvent, editorView: EditorView) {
    updateImageCursor(editorView, event)
    return false
  },

  keydown(event: KeyboardEvent, editorView: EditorView) {
    if (event.key === 'Control' || event.key === 'Meta') {
      editorView.contentDOM.style.cursor = ''
    }
    return false
  },

  keyup(event: KeyboardEvent, editorView: EditorView) {
    if (event.key === 'Control' || event.key === 'Meta') {
      editorView.contentDOM.style.cursor = ''
    }
    return false
  },

  contextmenu(event: MouseEvent, editorView: EditorView) {
    const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false

    const line = editorView.state.doc.lineAt(pos)
    const imagePattern = /!\[[^\]]*\]\(img:([a-f0-9-]+)\)(?:\{[^}]*\})?/g
    let match: RegExpExecArray | null
    while ((match = imagePattern.exec(line.text)) !== null) {
      const absFrom = line.from + match.index
      const absTo = absFrom + match[0].length
      if (pos >= absFrom && pos <= absTo) {
        event.preventDefault()
        imageContextMenu.value = { x: event.clientX, y: event.clientY, entryId: match[1]! }
        const close = (e: MouseEvent) => {
          if (contextMenuEl.value?.contains(e.target as Node)) return
          closeImageContextMenu()
          document.removeEventListener('mousedown', close)
        }
        setTimeout(() => document.addEventListener('mousedown', close), 0)
        return true
      }
    }
    return false
  },

  paste(event: ClipboardEvent, editorView: EditorView) {
    const items = event.clipboardData?.items
    if (!items) return false

    // Check if pasted text is a sentinel being re-pasted
    const text = event.clipboardData?.getData('text/plain') ?? ''
    const sentinelMatch = text.match(/^<!--uploading:([a-f0-9-]+)-->$/)
    if (sentinelMatch) {
      event.preventDefault()
      reinsertSentinel(editorView, sentinelMatch[1]!)
      return true
    }

    // Look for image items
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault()
      for (const file of imageFiles) startImageUpload(editorView, file)
      return true
    }

    return false
  },

  drop(event: DragEvent, editorView: EditorView) {
    const files = event.dataTransfer?.files
    if (!files) return false

    const imageFiles: File[] = []
    for (const file of files) {
      if (file.type.startsWith('image/')) imageFiles.push(file)
    }

    if (imageFiles.length > 0) {
      event.preventDefault()
      for (const file of imageFiles) startImageUpload(editorView, file)
      return true
    }

    return false
  },
})

const lilypadTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg)',
    color: 'var(--text-primary)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    overflow: 'auto',
    lineHeight: '1.6',
    scrollBehavior: 'smooth',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    padding: '10px 0',
    paddingBottom: '50vh',
  },
  '.cm-line': {
    padding: '0 8px',
  },
  '.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-selectionLayer': {
    zIndex: '2 !important',
    mixBlendMode: 'darken',
    pointerEvents: 'none',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--surface-overlay) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--surface-overlay) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
    minWidth: '48px',
  },
  '.cm-gutterElement': {
    padding: '0 12px 0 8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-secondary)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--surface) !important',
  },
  '.cm-highlight-line.cm-activeLine, .cm-highlight-line': {
    animation: 'cm-line-flash 1.5s ease-out forwards !important',
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent) !important',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--surface-elevated)',
  },
  // Search panel
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    borderTop: '1px solid var(--border-subtle)',
  },
  '.cm-search': {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    paddingTop: '12px',
    paddingBottom: '8px',
    paddingLeft: '12px',
    paddingRight: '12px',
    flexWrap: 'wrap',
  },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    transition: 'color 100ms',
  },
  '.cm-search label:hover': {
    color: 'var(--text-primary)',
  },
  // Close button — make it larger with a visible hover area
  '.cm-search button[name="close"]': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    padding: '0',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderRadius: '4px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    backgroundImage: 'none',
    fontSize: '20px',
    lineHeight: '1',
    marginLeft: '4px',
  },
  '.cm-search button[name="close"]:hover': {
    backgroundColor: 'var(--surface-elevated)',
    borderColor: 'var(--border)',
    color: 'var(--text-primary)',
  },
  '.cm-search button[name="close"]:active': {
    backgroundColor: 'var(--surface-overlay)',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '3px 8px',
    fontSize: '12px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-family-ui)',
    outline: 'none',
    minWidth: '130px',
  },
  '.cm-textfield:focus': {
    borderColor: 'var(--accent)',
  },
  '.cm-button': {
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundColor: 'var(--surface-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '3px 10px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-family-ui)',
    cursor: 'pointer',
    backgroundImage: 'none',
    textTransform: 'capitalize',
  },
  '.cm-button:hover': {
    backgroundColor: 'var(--surface-overlay)',
    color: 'var(--text-primary)',
  },
  '.cm-button:active': {
    backgroundColor: 'var(--border)',
    color: 'var(--text-primary)',
  },
  '.cm-button:focus': {
    outline: '2px solid var(--accent)',
    outlineOffset: '1px',
  },
  '.cm-fat-cursor': {
    background: 'color-mix(in srgb, var(--accent) 35%, transparent) !important',
    color: 'var(--text-primary) !important',
  },
  '&:not(.cm-focused) .cm-fat-cursor': {
    background: 'none !important',
    outline: '1px solid color-mix(in srgb, var(--accent) 50%, transparent) !important',
    color: 'transparent !important',
  },
})

watch(
  () => props.isActive,
  (active) => {
    if (active && view) {
      requestAnimationFrame(() => {
        view?.requestMeasure()
        view?.focus()
      })
    }
  },
)

watch(
  () => uiStore.editorFontSize,
  (size) => {
    if (!view) return
    view.dispatch({
      effects: fontSizeCompartment.reconfigure(
        EditorView.theme({ '&': { fontSize: `${size}px` } }),
      ),
    })
  },
)

watch(
  () => uiStore.vimEnabled,
  (enabled) => {
    if (!view) return
    view.dispatch({ effects: vimCompartment.reconfigure(enabled ? vim() : []) })
    if (enabled) applyVimSettings()
  },
)

watch(
  () => [uiStore.vimMappings, uiStore.vimEscTimeout] as const,
  () => {
    if (uiStore.vimEnabled) applyVimSettings()
  },
  { deep: true },
)

onMounted(() => {
  if (!container.value) return

  const doc = store.openDocuments.get(props.documentId)

  view = new EditorView({
    state: EditorState.create({
      doc: doc?.content ?? '',
      extensions: [
        vimCompartment.of(uiStore.vimEnabled ? vim() : []),
        keymap.of([
          { key: 'Tab', run: indentBullet },
          { key: 'Shift-Tab', run: dedentBullet },
          ...searchKeymap,
          {
            key: 'Mod-s',
            run: () => {
              store.saveDocument(props.documentId)
              return true
            },
          },
        ]),
        search(),
        basicSetup,
        lilypadTheme,
        fontSizeCompartment.of(
          EditorView.theme({ '&': { fontSize: `${uiStore.editorFontSize}px` } }),
        ),
        markdown(),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            store.updateContent(props.documentId, update.state.doc.toString())
          }
          if (update.focusChanged && update.view.hasFocus) {
            store.setFocusedPane('editor')
            syncClipboardToVimRegister()
          }
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number
            store.setEditorCursorLine(props.documentId, line)
          }
        }),
        EditorView.lineWrapping,
        highlightLineField,
        yankFlashField,
        uploadWidgetField,
        sentinelGuard,
        imgGhostNameField,
        imagePasteHandler,
      ],
    }),
    parent: container.value,
  })

  if (!vimExRegistered) {
    Vim.defineEx('w', 'w', () => {
      const activeId = store.activeDocumentId
      if (activeId) store.saveDocument(activeId)
    })
    vimExRegistered = true
  }

  if (uiStore.vimEnabled) applyVimSettings()

  const cm = getCM(view)

  // Per-instance yank tracking
  let visualYankPending: { from: number; to: number } | null = null
  // yyPending: set after first 'y' in non-visual mode, used to detect the second 'y' of yy
  let yyPending: { from: number; to: number } | null = null

  cm?.on('vim-keypress', (key: string) => {
    if (!view) return
    const mode = vimMode.value

    if (mode === 'visual' && key === 'y') {
      // Visual yank — capture selection now; vim-mode-change fires after and triggers the flash.
      // Also set a rAF backup in case mode-change doesn't fire.
      const sel = view.state.selection.main
      visualYankPending = {
        from: Math.min(sel.from, sel.to),
        to: Math.max(sel.from, sel.to),
      }
      requestAnimationFrame(() => {
        if (visualYankPending) {
          const range = visualYankPending
          visualYankPending = null
          handleYank(range.from, range.to)
        }
      })
    } else if (key === 'y' && yyPending) {
      // Second 'y' — complete yy
      const range = yyPending
      yyPending = null
      requestAnimationFrame(() => handleYank(range.from, range.to, true))
    } else if (key === 'y' && mode !== 'visual') {
      // First 'y' in normal/op-pending — save current line for potential yy
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      yyPending = { from: line.from, to: line.to }
    } else if (key === 'Y' && mode !== 'visual') {
      // Y — yank to end of line
      const head = view.state.selection.main.head
      const line = view.state.doc.lineAt(head)
      requestAnimationFrame(() => handleYank(head, line.to))
      yyPending = null
    } else {
      yyPending = null
    }
  })

  cm?.on('vim-mode-change', (e: { mode: string }) => {
    const prevMode = vimMode.value
    vimMode.value = e.mode as typeof vimMode.value

    // Flash + copy yanked range when exiting visual mode after a yank
    if (prevMode === 'visual' && e.mode !== 'visual' && visualYankPending) {
      const range = visualYankPending
      visualYankPending = null
      handleYank(range.from, range.to)
    }
  })

  view.focus()
  resolveStashedUploads(view)
})

watch(
  () => store.clearHighlightRequest,
  (docId) => {
    if (docId !== props.documentId || !view) return
    store.clearHighlightRequest = null
    if (highlightTimer) {
      clearTimeout(highlightTimer)
      highlightTimer = undefined
    }
    view.dispatch({ effects: highlightLineEffect.of(null) })
  },
)

watch(
  () => store.scrollToLineRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.scrollToLineRequest = null

    const targetLine = Math.min(Math.max(1, req.line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(targetLine)

    view.dispatch({
      effects: [
        EditorView.scrollIntoView(lineInfo.from, { y: 'nearest', yMargin: 80 }),
        highlightLineEffect.of(targetLine),
      ],
      ...(req.moveCursor ? { selection: { anchor: lineInfo.to } } : {}),
    })

    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      view?.dispatch({ effects: highlightLineEffect.of(null) })
    }, 1500)
  },
)

onBeforeUnmount(() => {
  if (highlightTimer) clearTimeout(highlightTimer)
  if (yankFlashTimer) clearTimeout(yankFlashTimer)
  view?.destroy()
  view = null
})
</script>

<template>
  <div class="h-full w-full flex flex-col overflow-hidden">
    <div ref="container" class="flex-1 overflow-hidden" />
    <div
      v-if="uiStore.vimEnabled"
      class="flex items-center h-6 px-3 shrink-0 border-t border-border-subtle bg-surface"
    >
      <span class="font-mono text-xs font-medium tracking-wide" :class="modeLabelClass">
        {{ modeLabel }}
      </span>
    </div>

    <!-- Image right-click context menu -->
    <Teleport to="body">
      <div
        v-if="imageContextMenu"
        ref="contextMenuEl"
        class="fixed z-50 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-36 font-ui text-sm"
        :style="{ left: imageContextMenu.x + 'px', top: imageContextMenu.y + 'px' }"
      >
        <button
          class="w-full text-left px-3 py-1.5 hover:bg-surface-elevated text-text-primary cursor-pointer"
          @click="startImageRename"
        >
          Rename image
        </button>
      </div>
    </Teleport>

    <!-- Inline image rename input (outside CM DOM so native selection works) -->
    <Teleport to="body">
      <input
        v-if="imageRenamePos"
        ref="renameInputEl"
        v-model="imageRenameInput"
        class="fixed z-50 cm-image-rename-input"
        :style="{ left: imageRenamePos.x + 'px', top: imageRenamePos.y + 'px' }"
        @keydown.enter="finishImageRename"
        @keydown.escape="cancelImageRename"
        @blur="finishImageRename"
      />
    </Teleport>
  </div>
</template>

<style>
@keyframes cm-line-flash {
  0% {
    background-color: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  100% {
    background-color: transparent;
  }
}

/* Force search panel overrides — CodeMirror theme styles have higher specificity
   due to a generated scope class, so !important is needed here. */
.cm-search {
  padding-top: 9px !important;
}

.cm-search button[name='close'] {
  font-size: 18px !important;
  width: 22px !important;
  height: 22px !important;
  line-height: 1 !important;
  position: absolute !important;
  top: 11px !important;
  right: 8px !important;
}

/* --- Case / Regexp toggle buttons ------------------------------------ */
.cm-search label {
  font-size: 0 !important; /* hide native text */
  gap: 0 !important;
  position: relative;
}

.cm-search label::after {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-size: 11px !important;
  font-weight: 600;
  font-family: var(--font-family-ui);
  line-height: 1;
  border-radius: 4px;
}

/* "case" label → Aa */
.cm-search label:first-of-type::after {
  content: 'Aa';
}

/* "regexp" label → .* */
.cm-search label:nth-of-type(2)::after {
  content: '.*';
}

/* Checked state → accent pill */
.cm-search label:has(input:checked)::after {
  background-color: var(--accent);
  color: white;
}

/* Hide the actual checkbox */
.cm-search label input[type='checkbox'] {
  appearance: none !important;
  -webkit-appearance: none !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  position: absolute !important;
}

.cm-yank-flash {
  background-color: color-mix(in srgb, var(--accent) 22%, transparent);
  border-radius: 2px;
}

.cm-cursor,
.cm-dropCursor {
  border-left-color: var(--text-primary) !important;
}

/* --- Upload spinner widget ------------------------------------------- */
.cm-upload-spinner {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--surface-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: var(--font-family-ui);
  font-size: 12px;
  color: var(--text-secondary);
  user-select: none;
}

.cm-upload-spinner-icon {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: cm-spinner-spin 0.8s linear infinite;
}

@keyframes cm-spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

/* --- Ghost image name ------------------------------------------------ */
.cm-image-ghost-name {
  color: var(--text-muted);
  font-style: italic;
  font-size: 0.85em;
  pointer-events: none;
  user-select: none;
}

.cm-image-rename-anchor {
  display: inline;
}

.cm-image-rename-input {
  padding: 1px 5px;
  font-size: 0.85em;
  font-style: italic;
  font-family: var(--font-family-mono);
  background: var(--surface);
  color: var(--text-secondary);
  border: 1px solid var(--accent);
  border-radius: 3px;
  outline: none;
}

.cm-image-rename-input::selection {
  background: var(--surface-overlay);
}
</style>
