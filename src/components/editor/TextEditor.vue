<!-- CodeMirror 6 editor with Vim keybindings, image drag-drop/paste upload, search highlighting, yank flash, and auto-save. -->
<script lang="ts">
// vimExRegistered is module-level (not per-instance) because Vim.defineEx registers
// commands on the global Vim object — calling it more than once throws.
let vimExRegistered = false

// appliedMappings is also module-level: all editor instances share the same Vim
// mapping table, so any instance must unmap the previous set before applying new ones.
let appliedMappings: Array<{ lhs: string; mode: string }> = []

// ---------------------------------------------------------------------------
// Image upload — module-level state (shared across all editor instances)
//
// When a user pastes or drops an image, we immediately insert a sentinel comment
// (<!--uploading:<uuid>-->) as a placeholder, kick off the upload, then replace
// the sentinel with the final ![](img:<id>) syntax on success. Because the user
// might switch tabs while the upload is in flight, completed/failed results are
// stashed in module-level Maps until the correct editor instance is active again.
// ---------------------------------------------------------------------------
interface UploadedImageResult {
  entryId: string
  storagePath: string
  publicUrl: string
}

/** In-flight uploads keyed by sentinel UUID. */
const detachedUploads = new Map<string, { promise: Promise<UploadedImageResult> }>()

/** Completed uploads stashed while the target editor was on a different tab. */
const completedUploads = new Map<string, UploadedImageResult>()

/** Failed uploads stashed while the target editor was on a different tab. */
const failedUploads = new Set<string>()

/** All upload sentinels in `doc`, with a fresh regex per call (no lastIndex state). */
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

// ---------------------------------------------------------------------------
// Upload spinner widget — replaces the sentinel comment in the editor display
// ---------------------------------------------------------------------------

/**
 * Scan the document for sentinel comments and build Decoration.replace entries
 * that hide the raw comment text behind the spinner widget.
 */
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
    // Re-scan on every document change to pick up new/removed sentinels.
    if (tr.docChanged) return buildUploadDecorations(tr.state)
    return decos
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Transaction filter that prevents partial edits to sentinel comments.
 * If an edit overlaps any part of a sentinel, the change is expanded to cover
 * the entire sentinel (including its trailing newline) so the placeholder is
 * always either fully present or fully removed — never in a broken state.
 */
const sentinelGuard = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr

  const doc = tr.startState.doc.toString()
  const sentinels: { from: number; to: number }[] = findSentinels(doc).map((s) => {
    // Include the trailing newline in the sentinel range so deleting the sentinel
    // with Backspace/dd doesn't leave a blank line.
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

// ---------------------------------------------------------------------------
// Ghost text widget — shows image entry name after img: references
// ---------------------------------------------------------------------------

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

/**
 * Apply the current Vim settings from the UI store to the global Vim object.
 * Must unmap all previously applied custom mappings before re-applying to avoid
 * accumulating stale mappings when the user edits their keybinding list.
 * Errors are silently swallowed because Vim.unmap() throws if the mapping doesn't exist.
 */
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

/**
 * Briefly highlight the yanked range using the cm-yank-flash decoration, then clear it
 * after 350 ms. The timer is reset on each call so rapid yanks don't leave stale flashes.
 */
function flashYankRange(from: number, to: number) {
  if (!view) return
  if (yankFlashTimer) clearTimeout(yankFlashTimer)
  view.dispatch({ effects: yankFlashEffect.of({ from, to }) })
  yankFlashTimer = setTimeout(() => {
    view?.dispatch({ effects: yankFlashEffect.of(null) })
    yankFlashTimer = undefined
  }, 350)
}

/**
 * Handle a Vim yank event: optionally flash the range and optionally sync the yanked
 * text to the system clipboard so it's available outside the browser.
 *
 * @param lineType - true for linewise yanks (yy/Y), which append a trailing newline
 *   to match Vim's register format so paste operations land on the correct line.
 */
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
 * On editor focus, read the system clipboard and write its content into Vim's unnamed
 * register ('"'). This allows yanks from outside the browser (e.g. terminal) to be
 * pasted with 'p' in Vim mode without the user manually triggering Ctrl+V.
 *
 * The cast to `any` is unavoidable: codemirror-vim does not expose the internal
 * register structure in its TypeScript types.
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

// ---------------------------------------------------------------------------
// Image paste / drop handlers
// ---------------------------------------------------------------------------

/**
 * Begin an image upload for a dropped or pasted file.
 * Inserts a sentinel comment immediately at the cursor so the user has visual
 * feedback that the upload is in progress; the sentinel is replaced by the final
 * markdown reference once the upload resolves.
 *
 * The image is uploaded to the same folder as the current document so the file
 * tree stays organised; falls back to the workspace root if no parent is found.
 */
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

/**
 * Called when an upload completes successfully.
 * If the editor is still mounted (dom has a parent), replace the sentinel with the
 * final image reference. If the user navigated away, stash the result in
 * completedUploads so resolveStashedUploads() can apply it when they return.
 */
function onUploadSuccess(editorView: EditorView, uuid: string, result: UploadedImageResult) {
  detachedUploads.delete(uuid)

  if (!editorView.dom.parentNode) {
    // Editor is currently hidden (user switched tabs). Stash for later.
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

/**
 * Called when an upload fails. Removes the sentinel from the document (to avoid
 * leaving broken placeholder text) and shows a toast. Stashes the failure if the
 * editor is hidden so it can be cleaned up when the user returns.
 */
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

/**
 * If the user copies and re-pastes a sentinel comment (e.g. undo followed by paste),
 * re-insert it at the cursor rather than pasting raw HTML comment text.
 * This only fires if the upload is still in flight (uuid is in detachedUploads).
 */
function reinsertSentinel(editorView: EditorView, uuid: string) {
  if (!detachedUploads.has(uuid)) return
  const sentinel = `<!--uploading:${uuid}-->`
  const cursor = editorView.state.selection.main.head
  editorView.dispatch({
    changes: { from: cursor, insert: sentinel + '\n' },
  })
}

/**
 * On editor mount (or tab return), scan for any sentinels whose uploads already
 * resolved or failed while this editor instance was hidden. Processes one sentinel
 * per call because each resolution changes the document, invalidating old positions.
 *
 * Precondition: editorView is mounted and its dom has a parent node.
 */
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

// ---------------------------------------------------------------------------
// Right-click rename for images
// ---------------------------------------------------------------------------
const imageContextMenu = ref<{ x: number; y: number; entryId: string } | null>(null)
const contextMenuEl = ref<InstanceType<typeof ContextMenu> | null>(null)
const imageRenamePos = ref<{ x: number; y: number } | null>(null)
const imageRenameInput = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)

function closeImageContextMenu() {
  imageContextMenu.value = null
}

/**
 * Begin inline renaming of an image referenced in the editor.
 * The rename input is a native <input> rendered via Teleport (outside the CM DOM)
 * and positioned over a zero-width RenameAnchorWidget injected after the image syntax.
 *
 * The double nextTick + rAF cascade is necessary because:
 *   1. Setting renamingImageId triggers a ghost decoration rebuild (nextTick to flush Vue).
 *   2. CodeMirror renders the new RenameAnchorWidget in the next paint frame (rAF).
 *   3. The input must be visible before we can focus it and bind the click-outside handler.
 */
function startImageRename() {
  if (!imageContextMenu.value) return
  const { entryId } = imageContextMenu.value
  const entry = filesStore.getEntry(entryId)
  if (!entry) return
  const dotIdx = entry.name.lastIndexOf('.')
  // Preserve the original file extension so the user only edits the base name.
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
        // Delay binding so the current mouseup from the context menu click doesn't immediately close.
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

// When this tab becomes active, force a CM layout measure and restore focus.
// rAF defers until the panel's CSS transition finishes so CM gets correct dimensions.
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

// Reconfigure the font-size compartment without destroying/recreating the CM instance.
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

// Hot-swap Vim mode via a compartment so the editor state (undo history, selections)
// is preserved when the user toggles it in settings.
watch(
  () => uiStore.vimEnabled,
  (enabled) => {
    if (!view) return
    view.dispatch({ effects: vimCompartment.reconfigure(enabled ? vim() : []) })
    if (enabled) applyVimSettings()
  },
)

// deep: true is required because vimMappings is an array of objects;
// Vue's default shallow comparison won't detect mutations to individual mapping objects.
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

  // Vim.defineEx is global — guard with vimExRegistered to avoid re-registering the
  // :w command every time a new TextEditor instance mounts.
  if (!vimExRegistered) {
    Vim.defineEx('w', 'w', () => {
      const activeId = store.activeDocumentId
      if (activeId) store.saveDocument(activeId)
    })
    vimExRegistered = true
  }

  if (uiStore.vimEnabled) applyVimSettings()

  const cm = getCM(view)

  // ---------------------------------------------------------------------------
  // Yank tracking state machine (per-instance, not module-level)
  //
  // codemirror-vim does not expose a dedicated yank event, so we reconstruct the
  // yanked range from keypress events:
  //   - 'y' in visual mode  → yank the current visual selection
  //   - 'y' 'y' in normal   → yank the current line (yy)
  //   - 'Y' in normal       → yank from cursor to end of line
  //
  // visualYankPending captures the selection at keypress time because by the time
  // vim-mode-change fires (exiting visual), the selection has already collapsed.
  // yyPending tracks the first 'y' so the second one knows it completes a yy.
  // ---------------------------------------------------------------------------

  let visualYankPending: { from: number; to: number } | null = null
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

// The preview pane calls requestClearEditorHighlight() when the user deselects a block.
// This watcher handles the resulting store mutation by clearing the CM line decoration.
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

// The search panel (and preview click) can request that the editor scrolls to a specific
// line and optionally highlights it. The highlight auto-clears after 1.5 s.
watch(
  () => store.scrollToLineRequest,
  (req) => {
    if (!req || req.documentId !== props.documentId || !view) return
    store.scrollToLineRequest = null

    // Clamp to valid line numbers in case the document was edited since the request was made.
    const targetLine = Math.min(Math.max(1, req.line), view.state.doc.lines)
    const lineInfo = view.state.doc.line(targetLine)

    view.dispatch({
      effects: [
        // yMargin: 80 keeps the target line off the very top of the viewport.
        EditorView.scrollIntoView(lineInfo.from, { y: 'nearest', yMargin: 80 }),
        highlightLineEffect.of(targetLine),
      ],
      // moveCursor: true when navigating from search results, so subsequent j/k
      // movements start from the highlighted line rather than the last cursor position.
      ...(req.moveCursor ? { selection: { anchor: lineInfo.to } } : {}),
    })

    if (highlightTimer) clearTimeout(highlightTimer)
    highlightTimer = setTimeout(() => {
      view?.dispatch({ effects: highlightLineEffect.of(null) })
    }, 1500)
  },
)

// The web-annotation "insert reference" action asks the editor to drop a `[quote](lily:hl-x)`
// link at the cursor. Insert at the current selection head and move the cursor after the text.
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

    <!-- Image right-click context menu -->
    <ContextMenu
      v-if="imageContextMenu"
      ref="contextMenuEl"
      :x="imageContextMenu.x"
      :y="imageContextMenu.y"
    >
      <ContextMenuItem :icon="Pencil" @click="startImageRename">Rename image</ContextMenuItem>
    </ContextMenu>

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
