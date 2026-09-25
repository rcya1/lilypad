<!-- CodeMirror editor: Vim mode, image paste/drop upload, line highlighting and yank flash. -->
<script lang="ts">
// Module-level: Vim.defineEx registers globally and throws if called twice.
let vimExRegistered = false

// Vim's mapping table is shared, so each apply must first unmap the previous set.
let appliedMappings: Array<{ lhs: string; mode: string }> = []

// Image uploads insert an `<!--uploading:<uuid>-->` placeholder, replaced by `![](img:<id>)` once
// the upload lands. Results are stashed here if the editor was unmounted (tab switch) meanwhile.
interface UploadedImageResult {
  entryId: string
  storagePath: string
  publicUrl: string
}

/** In flight, keyed by placeholder uuid. */
const detachedUploads = new Map<string, { promise: Promise<UploadedImageResult> }>()

/** Finished or failed while the editor was unmounted; applied on remount. */
const completedUploads = new Map<string, UploadedImageResult>()
const failedUploads = new Set<string>()

/** Fresh regex per call, so no shared `lastIndex` state. */
function findSentinels(doc: string): { uuid: string; from: number; to: number }[] {
  const pattern = /<!--uploading:([a-f0-9-]+)-->/g
  const results: { uuid: string; from: number; to: number }[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(doc)) !== null) {
    results.push({ uuid: m[1]!, from: m.index, to: m.index + m[0].length })
  }
  return results
}
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, StateEffect, StateField, Compartment, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap } from '@codemirror/search'
import { vim, getCM, Vim } from '@replit/codemirror-vim'
import { useEditorStore } from '@/stores/editor'
import { useFilesStore } from '@/stores/files'
import { useToastStore } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'
import { lilypadTheme } from './cm/theme'
import { UploadSpinnerWidget, GhostNameWidget, RenameAnchorWidget } from './cm/widgets'
import {
  highlightLineEffect,
  highlightLineField,
  yankFlashEffect,
  yankFlashField,
} from './cm/highlight'
import { indentBullet, dedentBullet } from './cm/commands'
import { latexMath, latexEditorExtensions } from './cm/latex'
import { conflictMarkers, externalEdit, replaceDocMinimally } from './cm/conflicts'
import { findImageRefs } from '@/lib/image-refs'
import { Pencil } from 'lucide-vue-next'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import ContextMenuItem from '@/components/ui/ContextMenuItem.vue'

function buildUploadDecorations(state: EditorState): DecorationSet {
  const builder: Range<Decoration>[] = []
  const doc = state.doc.toString()
  for (const sentinel of findSentinels(doc)) {
    builder.push(
      Decoration.replace({ widget: new UploadSpinnerWidget() }).range(sentinel.from, sentinel.to),
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

/** Edits touching a placeholder expand to cover all of it, so it's never left half-deleted. */
const sentinelGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const doc = tr.startState.doc.toString()
  const sentinels: { from: number; to: number }[] = findSentinels(doc).map((s) => {
    // Include the trailing newline so deleting it doesn't leave a blank line.
    const hasTrailingNewline = s.to < doc.length && doc[s.to] === '\n'
    return { from: s.from, to: hasTrailingNewline ? s.to + 1 : s.to }
  })

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
  for (const ref of findImageRefs(doc)) {
    const entry = filesStore.getEntry(ref.entryId)
    if (entry) {
      const pos = ref.to
      if (renamingImageId.value === ref.entryId) {
        builder.push(
          Decoration.widget({
            widget: new RenameAnchorWidget(ref.entryId),
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

/** Unmaps the previous set first. Vim.map/unmap throw on bad input, so errors are ignored. */
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

/** Linewise yanks (yy/Y) get a trailing newline, matching Vim's register format. */
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

/**
 * Copies the system clipboard into Vim's unnamed register on focus, so text copied outside the
 * browser pastes with `p`. codemirror-vim doesn't type its registers, hence the `any`.
 */
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

/** Inserts a placeholder at the cursor and uploads into the current note's folder. */
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

/** Swaps the placeholder for the image reference, or stashes the result if unmounted. */
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

/** Removes the placeholder and reports the error (stashed if unmounted). */
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

/** Re-pasting a placeholder whose upload is still running restores it rather than raw text. */
function reinsertSentinel(editorView: EditorView, uuid: string) {
  if (!detachedUploads.has(uuid)) return
  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = editorView.state.selection.main.head
  editorView.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })
}

/** Applies uploads that finished while unmounted, one per call since each edit shifts positions. */
function resolveStashedUploads(editorView: EditorView) {
  const doc = editorView.state.doc.toString()
  for (const { uuid } of findSentinels(doc)) {
    if (completedUploads.has(uuid)) {
      const result = completedUploads.get(uuid)!
      completedUploads.delete(uuid)
      onUploadSuccess(editorView, uuid, result)
      return // doc changed — re-scan would need a fresh toString()
    }

    if (failedUploads.has(uuid)) {
      failedUploads.delete(uuid)
      onUploadFailure(editorView, uuid)
      return
    }
  }
}

const imageContextMenu = ref<{ x: number; y: number; entryId: string } | null>(null)
const contextMenuEl = ref<InstanceType<typeof ContextMenu> | null>(null)
const imageRenamePos = ref<{ x: number; y: number } | null>(null)
const imageRenameInput = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

function closeImageContextMenu() {
  imageContextMenu.value = null
}

/**
 * The rename input is teleported outside CodeMirror and positioned over a RenameAnchorWidget:
 * rebuild the decorations, wait for CodeMirror to paint the anchor (rAF), then measure and focus.
 */
function startImageRename() {
  if (!imageContextMenu.value) return
  const { entryId } = imageContextMenu.value
  const entry = filesStore.getEntry(entryId)
  if (!entry) return
  const dotIdx = entry.name.lastIndexOf('.')
  // Only the base name is editable.
  renamingImageExt.value = dotIdx > 0 ? entry.name.slice(dotIdx) : ''
  const baseName = dotIdx > 0 ? entry.name.slice(0, dotIdx) : entry.name
  imageRenameInput.value = baseName
  renamingImageId.value = entryId
  closeImageContextMenu()
  rebuildGhosts()
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
        // Deferred, so the mouseup from the context menu click doesn't close it at once.
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
  for (const ref of findImageRefs(line.text)) {
    const absFrom = line.from + ref.from
    const absTo = line.from + ref.to
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
    for (const ref of findImageRefs(line.text)) {
      const absFrom = line.from + ref.from
      const absTo = line.from + ref.to
      if (pos >= absFrom && pos <= absTo) {
        event.preventDefault()
        uiStore.navigateToImage(ref.entryId)
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
    for (const ref of findImageRefs(line.text)) {
      const absFrom = line.from + ref.from
      const absTo = line.from + ref.to
      if (pos >= absFrom && pos <= absTo) {
        event.preventDefault()
        imageContextMenu.value = { x: event.clientX, y: event.clientY, entryId: ref.entryId }
        const close = (e: MouseEvent) => {
          if (contextMenuEl.value?.el?.contains(e.target as Node)) return
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

    // A re-pasted placeholder.
    const text = event.clipboardData?.getData('text/plain') ?? ''
    const sentinelMatch = text.match(/^<!--uploading:([a-f0-9-]+)-->$/)
    if (sentinelMatch) {
      event.preventDefault()
      reinsertSentinel(editorView, sentinelMatch[1]!)
      return true
    }

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

// On activation, re-measure once the panel's transition is done (rAF) and refocus.
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

// Via a compartment, so undo history and selection survive toggling Vim.
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
        markdown({ extensions: [latexMath] }),
        latexEditorExtensions,
        conflictMarkers,
        // basicSetup registers defaultHighlightStyle only as a *fallback*, which switches off
        // once any other highlighter (the LaTeX one above) is present — so register it directly.
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.updateListener.of((update) => {
          // Edits from sync (merges, newer server text) aren't the user's: don't mark dirty.
          const external = update.transactions.some((tr) => tr.annotation(externalEdit))
          if (update.docChanged && !external) {
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

  // codemirror-vim has no yank event, so yanks are reconstructed from keypresses: `y` in visual
  // mode, `yy` and `Y`. The visual selection is captured at keypress time because it has already
  // collapsed by the time vim-mode-change fires.

  let visualYankPending: { from: number; to: number } | null = null
  let yyPending: { from: number; to: number } | null = null

  cm?.on('vim-keypress', (key: string) => {
    if (!view) return
    const mode = vimMode.value

    if (mode === 'visual' && key === 'y') {
      // Flushed on the mode change below; the rAF is a fallback in case that doesn't fire.
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

    if (prevMode === 'visual' && e.mode !== 'visual' && visualYankPending) {
      const range = visualYankPending
      visualYankPending = null
      handleYank(range.from, range.to)
    }
  })

  view.focus()
  resolveStashedUploads(view)
})

// The preview deselected a block.
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

// From search results or the preview. The highlight clears after 1.5s.
watch(
  () => store.scrollToLineRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.scrollToLineRequest = null

    // The note may have changed since the request.
    const targetLine = Math.min(Math.max(1, req.line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(targetLine)

    view.dispatch({
      effects: [
        EditorView.scrollIntoView(lineInfo.from, { y: 'nearest', yMargin: 80 }),
        highlightLineEffect.of(targetLine),
      ],
      // From search results, so j/k continue from the highlighted line.
      ...(req.moveCursor ? { selection: { anchor: lineInfo.to } } : {}),
    })

    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      view?.dispatch({ effects: highlightLineEffect.of(null) })
    }, 1500)
  },
)

// Web annotations' "insert reference": insert at the cursor and move past it.
watch(
  () => store.insertTextRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.insertTextRequest = null
    const pos = view.state.selection.main.head
    view.dispatch({
      changes: { from: pos, insert: req.text },
      selection: { anchor: pos + req.text.length },
    })
    view.focus()
  },
)

// Text replaced from outside (a sync merge or newer server text): apply it as a minimal edit so
// the cursor stays put when the change is elsewhere in the note.
watch(
  () => store.externalContentRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.externalContentRequest = null
    replaceDocMinimally(view, req.content)
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

    <ContextMenu
      v-if="imageContextMenu"
      ref="contextMenuEl"
      :x="imageContextMenu.x"
      :y="imageContextMenu.y"
    >
      <ContextMenuItem :icon="Pencil" @click="startImageRename">Rename image</ContextMenuItem>
    </ContextMenu>

    <!-- Outside CodeMirror so native selection works -->
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

/* Case / regexp toggles */
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

.cm-search label:has(input:checked)::after {
  background-color: var(--accent);
  color: white;
}

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
