<!-- Modal for importing a document, either from a URL (a link to a PDF imports the PDF; anything
     else is captured as a web page) or from PDFs on the computer. -->
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { Download, Link, FileUp, X, Loader2 } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import type { EntryRow } from '@/types/database'

const props = defineProps<{
  /** null = top level. */
  parentId: string | null
}>()
const emit = defineEmits<{
  created: [entry: EntryRow]
  /** PDFs picked or dropped; the parent uploads them so the modal can close right away. */
  upload: [files: File[]]
  cancel: []
}>()

const filesStore = useFilesStore()
const mode = ref<'link' | 'file'>('link')
const url = ref('')
const status = ref<'idle' | 'fetching' | 'capturing'>('idle')
const error = ref<string | null>(null)

/** Adds https:// if there's no scheme; '' for blank input. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** arXiv abstract pages → the PDF itself (`/abs/2401.01234v2` → `/pdf/2401.01234v2`). */
function rewriteKnownLandingPages(target: string): string {
  return target.replace(/^(https?:\/\/(?:www\.)?arxiv\.org)\/abs\//i, '$1/pdf/')
}

function looksLikePdfUrl(target: string): boolean {
  try {
    return /\.pdf$/i.test(new URL(target).pathname)
  } catch {
    return false
  }
}

/**
 * Tries the URL as a PDF first (the server bails after the first bytes if it isn't one). If that
 * fails for a URL that doesn't look like a PDF, the web capture gets a go, since headless Chromium
 * gets past some sites that turn away a plain fetch.
 */
async function submit() {
  if (status.value !== 'idle') return
  const target = normalizeUrl(url.value)
  if (!target) {
    error.value = 'Enter a URL.'
    return
  }
  error.value = null
  try {
    status.value = 'fetching'
    const pdfTarget = rewriteKnownLandingPages(target)
    let entry: EntryRow | null = null
    try {
      entry = await filesStore.importPdfFromUrl(pdfTarget, props.parentId)
    } catch (err) {
      if (pdfTarget !== target || looksLikePdfUrl(target)) throw err
    }
    if (!entry) {
      status.value = 'capturing'
      entry = await filesStore.createWebDocument(target, props.parentId)
    }
    if (entry) emit('created', entry)
    else error.value = 'Could not add this link.'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Adding the link failed.'
  } finally {
    status.value = 'idle'
  }
}

const pdfInput = useTemplateRef<HTMLInputElement>('pdfInput')
const isDropTarget = ref(false)

function onPdfInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? [])
  input.value = ''
  if (list.length) emit('upload', list)
}

function onDrop(e: DragEvent) {
  isDropTarget.value = false
  const list = Array.from(e.dataTransfer?.files ?? [])
  if (list.length) emit('upload', list)
}

function setMode(next: 'link' | 'file') {
  mode.value = next
  error.value = null
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      @click.self="status === 'idle' && emit('cancel')"
    >
      <div class="bg-surface border border-border rounded-lg shadow-xl w-96 flex flex-col">
        <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span class="flex items-center gap-2 text-sm font-medium text-text-primary font-ui">
            <Download :size="15" class="text-accent" />
            Import
          </span>
          <button
            class="text-text-muted hover:text-text-primary cursor-pointer disabled:opacity-40"
            :disabled="status !== 'idle'"
            @click="emit('cancel')"
          >
            <X :size="15" />
          </button>
        </div>

        <div class="px-4 py-4 space-y-3">
          <div class="flex p-0.5 bg-bg border border-border rounded text-xs font-ui">
            <button
              v-for="option in [
                { value: 'link', label: 'From link', icon: Link },
                { value: 'file', label: 'Upload PDF', icon: FileUp },
              ] as const"
              :key="option.value"
              class="flex-1 flex items-center justify-center gap-1.5 py-1 rounded transition-colors duration-75 cursor-pointer disabled:cursor-not-allowed"
              :class="
                mode === option.value
                  ? 'bg-surface-overlay text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              "
              :disabled="status !== 'idle'"
              @click="setMode(option.value)"
            >
              <component :is="option.icon" :size="13" />
              {{ option.label }}
            </button>
          </div>

          <template v-if="mode === 'link'">
            <input
              v-model="url"
              type="url"
              placeholder="https://example.com/article or …/paper.pdf"
              class="w-full px-2.5 py-1.5 text-sm bg-bg border border-border rounded outline-none focus:border-accent text-text-primary font-ui disabled:opacity-60"
              :disabled="status !== 'idle'"
              @keydown.enter="submit"
              v-focus
            />
            <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
          </template>

          <button
            v-else
            class="w-full flex flex-col items-center gap-1.5 px-3 py-6 border border-dashed rounded text-xs font-ui transition-colors duration-75 cursor-pointer"
            :class="
              isDropTarget
                ? 'border-accent bg-surface-elevated text-text-primary'
                : 'border-border text-text-secondary hover:border-accent hover:text-text-primary'
            "
            @click="pdfInput?.click()"
            @dragover.prevent="isDropTarget = true"
            @dragleave="isDropTarget = false"
            @drop.prevent="onDrop"
          >
            <FileUp :size="18" class="text-text-muted" />
            Choose PDFs or drop them here
          </button>
          <input
            ref="pdfInput"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            class="hidden"
            @change="onPdfInputChange"
          />
        </div>

        <div class="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            class="px-3 py-1.5 text-xs font-ui text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors duration-75 cursor-pointer disabled:opacity-40"
            :disabled="status !== 'idle'"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            v-if="mode === 'link'"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-ui bg-accent text-white rounded hover:bg-accent-hover transition-colors duration-75 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            :disabled="status !== 'idle'"
            @click="submit"
          >
            <Loader2 v-if="status !== 'idle'" :size="13" class="animate-spin" />
            {{
              status === 'fetching' ? 'Fetching…' : status === 'capturing' ? 'Capturing…' : 'Add'
            }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
