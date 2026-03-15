import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const previewVisible = ref(localStorage.getItem('preview-visible') !== 'false')

  function togglePreview() {
    previewVisible.value = !previewVisible.value
    localStorage.setItem('preview-visible', String(previewVisible.value))
  }

  return {
    previewVisible,
    togglePreview,
  }
})
