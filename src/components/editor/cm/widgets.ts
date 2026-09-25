// CodeMirror WidgetTypes for the editor: upload spinner, image ghost name, rename anchor.
import { WidgetType } from '@codemirror/view'

/** Stands in for an `<!--uploading:<uuid>-->` placeholder. */
export class UploadSpinnerWidget extends WidgetType {
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-upload-spinner'
    wrap.setAttribute('contenteditable', 'false')
    const spinner = document.createElement('span')
    spinner.className = 'cm-upload-spinner-icon'
    wrap.appendChild(spinner)
    const label = document.createElement('span')
    label.className = 'cm-upload-spinner-label'
    label.textContent = 'Uploading image…'
    wrap.appendChild(label)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

/** The image's name, as muted text after `![](img:<id>)`. */
export class GhostNameWidget extends WidgetType {
  constructor(private name: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-ghost-name'
    span.textContent = ` ${this.name}`
    return span
  }

  eq(other: GhostNameWidget) {
    return this.name === other.name
  }

  ignoreEvent() {
    return true
  }
}

/** Zero-width stand-in for the name while renaming; the rename input is positioned over it. */
export class RenameAnchorWidget extends WidgetType {
  constructor(private id: string) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-image-rename-anchor'
    span.dataset.renameAnchor = this.id
    return span
  }

  eq(other: RenameAnchorWidget) {
    return this.id === other.id
  }

  ignoreEvent() {
    return true
  }
}
