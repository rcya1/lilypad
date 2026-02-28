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
