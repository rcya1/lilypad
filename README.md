# Lilypad

My notetaking setup built on top of [remark](https://github.com/remarkjs/remark) and a custom VSCode extension for browsing notes.

All of my notes source files are stored in `/src` and are rendered automatically via GitHub actions to `/rendered`.

## Usage

Run `yarn` and `yarn run watch` to begin the watcher, which will automatically render any `.md` files placed in `./src`. Both an HTML and PDF will be generated in `./rendered/html` and `./rendered/pdf` respectively.

## Structure

- `./src` - source file for all notes
- `./rendered` - rendered notes (both PDFs and HTML pages)
- `./watcher` - notes compiler
- `.config` - config files for compiler
- `./lilypad-extension` - VS Code extension for easily previewing rendered HTML while opening markdown, automatically running the watcher, and browsing notes by the desired order

## TODO

- Add the rest of my notes from college
- Improve watcher to check modification dates to see when to rebuild files
- If the image parser cannot find the image; put a custom warning / admonition
- Add the drag and drop for the explorer
