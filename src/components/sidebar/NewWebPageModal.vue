<script setup lang="ts">
import { ref } from 'vue'
import { Globe, X } from 'lucide-vue-next'
import { useFilesStore } from '@/stores/files'
import type { EntryRow } from '@/types/database'

const props = defineProps<{ parentId: string | null }>()
const emit = defineEmits<{
  created: [entry: EntryRow]
  cancel: []
}>()

const filesStore = useFilesStore()
const url = ref('')
const capturing = ref(false)
const error = ref<string | null>(null)

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

async function submit() {
  if (capturing.value) return
  const target = normalizeUrl(url.value)
  if (!target) {
    error.value = 'Enter a URL.'
    return
  }
  capturing.value = true
  error.value = null
  try {
    const entry = await filesStore.createWebDocument(target, props.parentId)
    if (entry) emit('created', entry)
    else error.value = 'Could not create the web document.'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Capture failed.'
  } finally {
    capturing.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      @click.self="!capturing && emit('cancel')"
    >
      <div class="bg-surface border border-border rounded-lg shadow-xl w-96 flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <span class="flex items-center gap-2 text-sm font-medium text-text-primary font-ui">
            <Globe :size="15" class="text-accent" />
            New web page
          </span>
          <button
            class="text-text-muted hover:text-text-primary cursor-pointer disabled:opacity-40"
            :disabled="capturing"
            @click="emit('cancel')"
          >
            <X :size="15" />
          </button>
        </div>

        <!-- Body -->
        <div class="px-4 py-4 space-y-2">
          <label class="block text-xs font-medium text-text-muted uppercase tracking-widest">
            Page URL
          </label>
          <input
            v-model="url"
            type="url"
            placeholder="https://example.com/article"
            class="w-full px-2.5 py-1.5 text-sm bg-bg border border-border rounded outline-none focus:border-accent text-text-primary font-ui disabled:opacity-60"
            :disabled="capturing"
            @keydown.enter="submit"
            @vue:mounted="($event as any).el.focus()"
          />
          <p v-if="error" class="text-xs text-red-600">{{ error }}</p>
          <p v-else class="text-xs text-text-muted">
            We capture a static snapshot of the page so you can annotate it.
          </p>
        </div>

        <!-- Actions -->
        <div class="flex justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            class="px-3 py-1.5 text-xs font-ui text-text-secondary hover:text-text-primary hover:bg-surface-elevated rounded transition-colors duration-75 cursor-pointer disabled:opacity-40"
            :disabled="capturing"
            @click="emit('cancel')"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs font-ui bg-accent text-white rounded hover:bg-accent/90 transition-colors duration-75 cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            :disabled="capturing"
            @click="submit"
          >
            {{ capturing ? 'Capturing…' : 'Capture' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
