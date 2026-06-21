# Changelog

## [Unreleased]

## [0.1.0] - 2026-06-20

First deployed version.

### Added

- **Markdown editing** with a split-pane live preview.
- **Custom markdown renderer** built on Marked, with KaTeX math (inline macros)
  and styled admonition blocks (`info`, `definition`, `theorem`, `proposition`).
- **CodeMirror 6 editor** with markdown syntax support and Vim mode, including
  configurable Vim mappings, esc timeout, clipboard sync, and yank highlighting.
- **File explorer** with folders, drag-and-drop move, bulk operations, rename,
  a breadcrumb trail, and collapsible sections.
- **Tabs** for working across multiple open documents.
- **Image paste & management**: paste or drop images into the editor with an
  inline upload spinner, entry-based storage, sizing syntax (`{w-500}`, `{h-300}`,
  `{w-1/2}`, …), centered captions, ghost-text display names, right-click rename,
  a dedicated Images tab, hard-linking across notes, and Ctrl+click navigation.
- **Full-text search** across notes.
- **Editor <-> preview sync**: cursor tracking, source-line highlighting, and
  smooth scrolling between panes.
- **Supabase backend** for auth, document storage, and persisted user settings.
- **Layout & display controls**: adjustable editor/preview font sizes, preview
  visibility toggle, and persisted preview scroll position.

[Unreleased]: https://github.com/rcya1/lilypad-v2/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rcya1/lilypad-v2/releases/tag/v0.1.0
