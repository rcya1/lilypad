# Lilypad

My notetaking and homework setup built on top of [crossnote](https://github.com/shd101wyy/crossnote) and a custom VSCode extension for browsing notes. Still heavily WIP.

## Structure

- `.crossnote` - config files for crossnote
- `./src` - source file for all notes
- `./rendered` - rendered notes (both PDFs and HTML pages)
- `./index.js` - script that automatically watches `./src` directory to render any modified or new notes
