# Lilypad

My notetaking and homework setup built on top of [remark](https://github.com/remarkjs/remark) and a custom VSCode extension for browsing notes.

## Usage

Run `yarn` and `yarn run watch` to begin the watcher, which will automatically render any `.md` files placed in `./src`. Both an HTML and PDF will be generated in `./rendered/html` and `./rendered/pdf` respectively.

## Structure

- `./src` - source file for all notes
- `./rendered` - rendered notes (both PDFs and HTML pages)
- `./watcher` - notes compiler
- `.config` - config files for compiler
- `./lilypad-extension` - VS Code extension for easily previewing rendered HTML while opening markdown and browsing notes by creation date order (WIP)
