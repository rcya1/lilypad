# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
yarn dev          # Start development server
yarn build        # Type-check + build for production
yarn type-check   # Run vue-tsc type checking
yarn lint         # Run oxlint + eslint with auto-fix
yarn format       # Format with Prettier
yarn preview      # Preview production build
```

No test suite is currently configured.

## Architecture

Lilypad is a Vue 3 + TypeScript SPA built with Vite. It is an app for taking notes either by annotating PDFs or by creating text files. Notes are rendered using a custom markdown renderer.

**Stack:** Vue 3, Pinia (state), Vue Router, Tailwind CSS v4, TypeScript

**Key conventions:**

- No semicolons, single quotes, 100-char line width (Prettier)
- `@` path alias maps to `./src`
- SVGs imported as Vue components via `vite-svg-loader`
- Dual linting: oxlint (fast, Rust-based) + ESLint (Vue/TS rules)

**Structure:**

- `src/components/` — Vue components, organized by feature area (e.g. `sidebar/`)
- `src/stores/` — Pinia stores
- `src/types/` — Shared TypeScript types
- `src/router/` — Vue Router config (currently no routes defined)
- `src/assets/` — SVG icons (light/dark variants for the Lilypad logo)

**File explorer types** (`src/types/file-explorer.ts`): The `Entry` union type represents either a `Directory` (with recursive `children`) or a `Document` (with a `DocumentType` of `'pdf' | 'txt'`). Use the `isDirectory()` type guard to narrow entries.

**Sidebar** (`src/components/sidebar/`): Implements drag-to-resize (160–500px range) using raw DOM event listeners, cleaned up in `onBeforeUnmount`. The file explorer currently uses mock data.

## Design System

**Mode:** Light mode only now; dark mode infrastructure is in place. Toggle `.dark` class on `<html>` to activate dark mode.

**Tokens** — CSS vars defined in `:root` / `.dark`, bridged to Tailwind utilities via `@theme { --color-* }`:

| CSS var              | Tailwind utility            | Light value | Role                              |
| -------------------- | --------------------------- | ----------- | --------------------------------- |
| `--bg`               | `bg-bg`                     | `#eff5ef`   | Main canvas (light mint)          |
| `--surface`          | `bg-surface`                | `#e3ede3`   | Sidebar/panel fill                |
| `--surface-elevated` | `bg-surface-elevated`       | `#d6e5d6`   | Hover states                      |
| `--surface-overlay`  | `bg-surface-overlay`        | `#c8dbc8`   | Active/selected                   |
| `--border`           | `border-border`             | `#aec8ae`   | Visible borders                   |
| `--border-subtle`    | `border-border-subtle`      | `#ccdacc`   | Faint separators                  |
| `--text-primary`     | `text-text-primary`         | `#1a2a1a`   | Main text (dark green)            |
| `--text-secondary`   | `text-text-secondary`       | `#3d5c3d`   | Labels, filenames                 |
| `--text-muted`       | `text-text-muted`           | `#6b8c6b`   | Chevrons, placeholders            |
| `--accent`           | `text-accent` / `bg-accent` | `#2d6b2d`   | Forest green — interactive/active |
| `--amber`            | `text-amber` / `bg-amber`   | `#b5823a`   | Folders, PDFs                     |

**Typography:**

- **Inter** (300–600, loaded via Google Fonts): All UI chrome → `font-ui` utility (`--font-family-ui`)
- **Lora** (italic 400–600, loaded via Google Fonts): App title wordmark, empty state headings → `font-display` utility (`--font-family-display`)
- **System mono** (no load): Code blocks → `font-mono` utility

**Icons:** `lucide-vue-next` throughout. Standard sizes: 12px chevrons, 15px file/folder icons, 16px toolbar icons.

**Color roles:** accent (green) for interactive/resize/active states; amber for folders and PDFs.
