// CodeMirror theme mapping Lilypad design tokens (CSS vars) onto editor chrome.
import { EditorView } from 'codemirror'

export const lilypadTheme = EditorView.theme({
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
  // LaTeX math (classes from latexEditorExtensions in cm/latex.ts)
  '.cm-math-block': {
    backgroundColor: 'var(--surface)',
    boxShadow: 'inset 2px 0 0 color-mix(in srgb, var(--amber) 45%, transparent)',
  },
  '.cm-math-mark': {
    color: 'var(--amber)',
    fontWeight: '600',
  },
  '.cm-math-command': {
    color: 'var(--accent)',
  },
  '.cm-math-env': {
    color: 'var(--amber)',
    fontStyle: 'italic',
  },
  '.cm-math-brace': {
    color: 'var(--text-muted)',
  },
  '.cm-math-script': {
    color: 'var(--text-secondary)',
    fontWeight: '600',
  },
  '.cm-math-align': {
    color: 'var(--amber)',
  },
  '.cm-math-comment': {
    color: 'var(--text-muted)',
    fontStyle: 'italic',
  },
  '.cm-math-number': {
    color: 'color-mix(in srgb, var(--amber) 65%, var(--text-primary))',
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
