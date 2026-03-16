<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import type { VimMapping } from '@/stores/ui'

const uiStore = useUiStore()
const auth = useAuthStore()
const uid = () => auth.user?.id

function handleEscTimeoutChange(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10)
  if (!isNaN(val) && val >= 0 && val <= 5000) uiStore.setVimEscTimeout(val, uid())
}

function updateField(
  id: string,
  field: keyof Omit<VimMapping, 'id'>,
  value: string | boolean,
) {
  uiStore.updateVimMapping(id, { [field]: value } as Partial<Omit<VimMapping, 'id'>>, uid())
}

function addMapping() {
  uiStore.addVimMapping({ lhs: '', rhs: '', mode: 'normal', noremap: true }, uid())
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Vim enabled -->
    <div class="flex items-center justify-between">
      <span class="text-sm text-text-secondary font-ui">Vim mode</span>
      <button
        role="switch"
        :aria-checked="uiStore.vimEnabled"
        class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
        :class="uiStore.vimEnabled ? 'bg-[#548f54]' : 'bg-surface-overlay'"
        @click="uiStore.setVimEnabled(!uiStore.vimEnabled, uid())"
      >
        <span
          class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
          :class="uiStore.vimEnabled ? 'translate-x-4' : 'translate-x-0'"
        />
      </button>
    </div>

    <div
      class="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
      :class="uiStore.vimEnabled ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
    >
      <div class="overflow-hidden">
        <div class="flex flex-col gap-4">
          <div class="border-t border-border-subtle" />

      <!-- Escape key timeout -->
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="text-sm text-text-secondary font-ui">Escape key timeout</p>
          <p class="text-xs text-text-muted mt-0.5">
            Delay (ms) before a partial key sequence resolves — lower values make
            <code class="font-mono">jk</code>→Esc feel snappier
          </p>
        </div>
        <input
          type="number"
          :value="uiStore.vimEscTimeout"
          min="0"
          max="5000"
          class="w-20 px-2 py-1 text-xs font-mono bg-bg border border-border rounded text-text-primary text-right outline-none focus:border-accent shrink-0"
          @change="handleEscTimeoutChange"
        />
      </div>

      <!-- Highlight on yank -->
      <div class="flex items-center justify-between">
        <span class="text-sm text-text-secondary font-ui">Highlight on yank</span>
        <button
          role="switch"
          :aria-checked="uiStore.highlightOnYank"
          class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
          :class="uiStore.highlightOnYank ? 'bg-[#548f54]' : 'bg-surface-overlay'"
          @click="uiStore.setHighlightOnYank(!uiStore.highlightOnYank, uid())"
        >
          <span
            class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
            :class="uiStore.highlightOnYank ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <!-- Clipboard sync -->
      <div class="flex items-center justify-between">
        <span class="text-sm text-text-secondary font-ui">Sync with system clipboard</span>
        <button
          role="switch"
          :aria-checked="uiStore.vimClipboardSync"
          class="relative w-9 h-5 rounded-full transition-colors duration-150 cursor-pointer shrink-0"
          :class="uiStore.vimClipboardSync ? 'bg-[#548f54]' : 'bg-surface-overlay'"
          @click="uiStore.setVimClipboardSync(!uiStore.vimClipboardSync, uid())"
        >
          <span
            class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-150"
            :class="uiStore.vimClipboardSync ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <div class="border-t border-border-subtle" />

      <!-- Key mappings -->
      <div>
        <p class="text-sm text-text-secondary font-ui mb-3">Key mappings</p>

        <div v-if="uiStore.vimMappings.length > 0" class="mb-2">
          <!-- Header -->
          <div class="grid gap-1.5 px-0.5 mb-1" style="grid-template-columns: 76px 1fr 1fr 56px 24px">
            <span class="text-xs text-text-muted">Mode</span>
            <span class="text-xs text-text-muted">From</span>
            <span class="text-xs text-text-muted">To</span>
            <span class="text-xs text-text-muted text-center">Noremap</span>
            <span />
          </div>

          <!-- Rows -->
          <div
            v-for="m in uiStore.vimMappings"
            :key="m.id"
            class="grid gap-1.5 items-center mb-1"
            style="grid-template-columns: 76px 1fr 1fr 56px 24px"
          >
            <select
              :value="m.mode"
              class="px-1.5 py-1 text-xs bg-bg border border-border rounded text-text-secondary outline-none focus:border-accent cursor-pointer"
              @change="updateField(m.id, 'mode', ($event.target as HTMLSelectElement).value)"
            >
              <option value="normal">Normal</option>
              <option value="insert">Insert</option>
              <option value="visual">Visual</option>
            </select>
            <input
              :value="m.lhs"
              type="text"
              placeholder="jk"
              class="px-1.5 py-1 text-xs font-mono bg-bg border border-border rounded text-text-primary outline-none focus:border-accent min-w-0"
              @change="updateField(m.id, 'lhs', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="m.rhs"
              type="text"
              placeholder="<Esc>"
              class="px-1.5 py-1 text-xs font-mono bg-bg border border-border rounded text-text-primary outline-none focus:border-accent min-w-0"
              @change="updateField(m.id, 'rhs', ($event.target as HTMLInputElement).value)"
            />
            <div class="flex justify-center">
              <input
                type="checkbox"
                :checked="m.noremap"
                class="accent-[#548f54] cursor-pointer w-4 h-4"
                @change="
                  updateField(m.id, 'noremap', ($event.target as HTMLInputElement).checked)
                "
              />
            </div>
            <button
              class="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
              @click="uiStore.removeVimMapping(m.id, uid())"
            >
              <X :size="12" />
            </button>
          </div>
        </div>

        <button
          class="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer mt-1"
          @click="addMapping"
        >
          <Plus :size="12" />
          Add mapping
        </button>
          </div>
      </div>
    </div>
    </div>
  </div>
</template>
