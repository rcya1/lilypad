<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useEditorStore } from '@/stores/editor'
import { parseMarkdown } from '@/lib/markdown'
import 'katex/dist/katex.min.css'

const props = defineProps<{ documentId: string }>()

const store = useEditorStore()
const html = ref('')

async function render(content: string) {
  html.value = await parseMarkdown(content)
}

onMounted(() => {
  const doc = store.openDocuments.get(props.documentId)
  render(doc?.content ?? '')
})

watch(
  () => store.openDocuments.get(props.documentId)?.content,
  (content) => render(content ?? ''),
)
</script>

<template>
  <div class="preview-scroll h-full overflow-y-auto">
    <div class="markdown-body" v-html="html" />
  </div>
</template>

<style scoped>
.preview-scroll {
  background: var(--bg);
}

.markdown-body {
  max-width: 720px;
  margin: 0 auto;
  padding: 28px 32px 48px;
  font-family: var(--font-family-ui);
  font-size: 14px;
  line-height: 1.75;
  color: var(--text-primary);
}

/* Headings */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-family: var(--font-family-display);
  font-weight: 500;
  line-height: 1.3;
  margin-top: 1.6em;
  margin-bottom: 0.5em;
  color: var(--text-primary);
}

.markdown-body :deep(h1) {
  font-size: 1.75rem;
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: 0.3em;
  margin-top: 0;
}
.markdown-body :deep(h2) {
  font-size: 1.35rem;
}
.markdown-body :deep(h3) {
  font-size: 1.1rem;
}
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 1rem;
}

/* Paragraphs & spacing */
.markdown-body :deep(p) {
  margin: 0.75em 0;
}

/* Links */
.markdown-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.markdown-body :deep(a:hover) {
  opacity: 0.8;
}

/* Inline code */
.markdown-body :deep(code) {
  font-family: var(--font-family-mono);
  font-size: 0.85em;
  background: var(--surface-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  padding: 0.1em 0.35em;
  color: var(--text-primary);
}

/* Code blocks */
.markdown-body :deep(pre) {
  background: var(--surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1em 0;
}
.markdown-body :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.82rem;
  line-height: 1.6;
}

/* Blockquotes */
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--border);
  margin: 1em 0;
  padding: 0.4em 1em;
  color: var(--text-secondary);
}
.markdown-body :deep(blockquote p) {
  margin: 0;
}

/* Lists */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin: 0.75em 0;
}
.markdown-body :deep(li) {
  margin: 0.2em 0;
}
.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 0.1em 0;
}

/* Tables */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 1em 0;
  font-size: 0.9em;
}
.markdown-body :deep(th) {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 6px 12px;
  font-weight: 600;
  text-align: left;
}
.markdown-body :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 6px 12px;
}
.markdown-body :deep(tr:nth-child(even) td) {
  background: var(--surface);
}

/* Horizontal rule */
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.5em 0;
}

/* Images */
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

/* KaTeX display blocks */
.markdown-body :deep(.katex-display) {
  margin: 1em 0;
  overflow-x: auto;
}

/* Admonitions */
.markdown-body :deep(.admonition) {
  border-radius: 6px;
  border-left: 3px solid var(--border);
  background: var(--surface);
  margin: 1.25em 0;
  overflow: hidden;
}

.markdown-body :deep(.admonition-title) {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--surface-elevated);
  border-bottom: 1px solid var(--border-subtle);
}

.markdown-body :deep(.admonition-body) {
  padding: 10px 14px;
}
.markdown-body :deep(.admonition-body > p:first-child) {
  margin-top: 0;
}
.markdown-body :deep(.admonition-body > p:last-child) {
  margin-bottom: 0;
}

/* Admonition type colours */
.markdown-body :deep(.admonition-info) {
  border-left-color: #4a9a9a;
}
.markdown-body :deep(.admonition-info .admonition-title) {
  color: #4a9a9a;
}

.markdown-body :deep(.admonition-definition) {
  border-left-color: var(--amber);
}
.markdown-body :deep(.admonition-definition .admonition-title) {
  color: var(--amber);
}

.markdown-body :deep(.admonition-theorem),
.markdown-body :deep(.admonition-proposition) {
  border-left-color: var(--accent);
}
.markdown-body :deep(.admonition-theorem .admonition-title),
.markdown-body :deep(.admonition-proposition .admonition-title) {
  color: var(--accent);
}
</style>
