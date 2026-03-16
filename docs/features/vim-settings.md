# Feature: Vim Settings

## Overview

Allow users to configure vim behaviour through a structured settings panel (gear icon in sidebar
footer → Settings modal). All settings are persisted in `localStorage` and applied on every editor
mount.

---

## User-Facing Settings

### Vim mode toggle
On/off. Default: on. Toggling off removes the fat cursor, vim keybindings, and the status bar
(`-- INSERT --` etc.) without a page reload.

### Escape key timeout (ms)
How long the vim engine waits after a partial key sequence before resolving it. Controls how
snappy multi-char escape mappings like `jk`→`<Esc>` feel. Default: 200 ms.

### Highlight on yank
Flash the yanked region with a brief green highlight after every yank operation. Default: on.
Covered cases: visual-mode yank (`y`), `yy`, `Y`. Complex operator-pending motions (`yw`, `y3j`)
are not covered in V1.

### Sync with system clipboard
- **Yank → clipboard**: when vim yanks, the yanked text is written to `navigator.clipboard`.
- **Clipboard → vim register**: when the editor gains focus, the system clipboard is read into the
  vim unnamed register (`"`) so that `p`/`P` pastes from the system clipboard. Default: on.

### Key mappings table
A table of custom key mappings. Each row has:

| Column | Values |
|---|---|
| Mode | `normal` / `insert` / `visual` |
| From (lhs) | key sequence, e.g. `jk`, `<Space>w` |
| To (rhs) | target, e.g. `<Esc>`, `:w<CR>` |
| Noremap | checkbox — non-recursive (preferred; prevents infinite loops) |

Rows are applied via `Vim.noremap` / `Vim.map`. Empty `lhs` or `rhs` rows are skipped.

---

## What the Vim API Actually Supports

The `Vim` object from `@replit/codemirror-vim` exposes:

| Method | Purpose |
|---|---|
| `Vim.map(lhs, rhs, ctx?)` | Key mapping — rhs is re-mapped recursively (like `:map`) |
| `Vim.noremap(lhs, rhs, ctx?)` | Non-recursive key mapping (like `:noremap`) — prefer this |
| `Vim.unmap(lhs, ctx?)` | Remove a mapping |
| `Vim.setOption(name, value)` | Set a built-in or custom option globally |
| `Vim.defineOption(name, default, type, aliases?, cb?)` | Register a new option so `:set` can use it |
| `Vim.defineEx(name, prefix, fn)` | Register a custom ex command |

`ctx` for map/noremap/unmap is `'normal'`, `'insert'`, or `'visual'`.

**Built-in options** (settable via `Vim.setOption`):

| Option | Type | Default | Notes |
|---|---|---|---|
| `pcre` | boolean | `true` | Use JS regex in search instead of Vim regex |
| `textwidth` / `tw` | number | `80` | Line length hint for `gq` |
| `insertModeEscKeysTimeout` | number | `200` | ms before ambiguous escape sequence resolves |
| `filetype` / `ft` | string | `''` | Passed to CodeMirror as the language mode |
| `langmap` / `lmap` | string | `''` | Character remapping for non-QWERTY layouts |

**`insertModeEscKeysTimeout` and multi-char sequences**: when you map `jk`→`<Esc>` in insert mode,
the vim engine pauses after `j` to decide if you're typing `jk` or just `j`. This timeout controls
that window. Lowering it makes `jk` feel instant; raising it gives more time for the second key.

---

## Architecture

### `src/stores/ui.ts`
- `vimEnabled`, `vimEscTimeout`, `vimMappings: VimMapping[]`, `highlightOnYank`, `vimClipboardSync`
- All persisted to `localStorage`
- `VimMapping = { id, lhs, rhs, mode, noremap }`

### `src/components/editor/TextEditor.vue`
- `vimCompartment` (Compartment) wraps `vim()` — reconfigured on `vimEnabled` toggle
- `applyVimSettings()` — unmaps all previously-applied mappings, then re-applies from store
- `appliedMappings` — module-level array tracking what was mapped so it can be unmapped on re-apply
- Highlight-on-yank via `yankFlashField` StateField + `yankFlashEffect`
- Clipboard sync: writes on yank, reads on editor focus via `navigator.clipboard`
- Status bar `v-if="uiStore.vimEnabled"`

### `src/components/settings/VimSettings.vue`
Structured settings panel: toggles, number input, mappings table.

### `src/components/settings/SettingsModal.vue`
Modal wrapper (Teleport to body). Closed by Esc key or backdrop click.

### `src/components/sidebar/LilypadSidebar.vue`
Gear icon in the sidebar footer opens the settings modal.

---

## Edge Cases

- Toggling vim off mid-document does not lose content or cursor position.
- `:w` ex command is registered once (module-level `vimExRegistered` flag) and persists across
  vim toggles since `Vim` state is module-level.
- Mapping updates: all previously-applied mappings are unmapped before re-applying, so removed or
  edited rows don't leave stale bindings.
- Empty `lhs`/`rhs` rows are silently skipped when applying.
- Clipboard sync `readText()` requires browser permission; errors are swallowed silently.
- Highlight-on-yank for operator-pending motions (`yw`, `y3j`, etc.) is not covered in V1 —
  only visual yank, `yy`, and `Y` are detected.

---

## Future / V2

- Highlight-on-yank for arbitrary operator-pending motions
- `hlsearch`, `ignorecase`, `smartcase` via `Vim.defineOption()` + CodeMirror extension callbacks
- `scrolloff` support (requires a custom scroll-padding extension)
- Additional settings sections in the modal (font sizes, preview options, etc.)
