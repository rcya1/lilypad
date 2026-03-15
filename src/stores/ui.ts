import { defineStore } from 'pinia'
import { ref } from 'vue'

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 24

function readFontSize(key: string, defaultVal: number): number {
  const raw = localStorage.getItem(key)
  if (raw === null) return defaultVal
  const n = parseInt(raw, 10)
  if (isNaN(n)) return defaultVal
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))
}

export const useUiStore = defineStore('ui', () => {
  const previewVisible = ref(localStorage.getItem('preview-visible') !== 'false')
  const previewFontSize = ref(readFontSize('preview-font-size', 15))
  const editorFontSize = ref(readFontSize('editor-font-size', 13))

  function togglePreview() {
    previewVisible.value = !previewVisible.value
    localStorage.setItem('preview-visible', String(previewVisible.value))
  }

  function setPreviewFontSize(size: number) {
    previewFontSize.value = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size))
    localStorage.setItem('preview-font-size', String(previewFontSize.value))
  }

  function setEditorFontSize(size: number) {
    editorFontSize.value = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, size))
    localStorage.setItem('editor-font-size', String(editorFontSize.value))
  }

  return {
    previewVisible,
    previewFontSize,
    editorFontSize,
    togglePreview,
    setPreviewFontSize,
    setEditorFontSize,
  }
})
