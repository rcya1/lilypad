// CodeMirror WidgetTypes for the editor: upload spinner, image ghost name, rename anchor.
import { WidgetType } from '@codemirror/view'

/**
 * A CodeMirror WidgetType that replaces an `<!--uploading:<uuid>-->` sentinel
 * comment with a visible spinner pill. contenteditable=false prevents the user
 * from placing the cursor inside the widget.
 */
export class UploadSpinnerWidget extends WidgetType {
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-upload-spinner'
    // contenteditable=false ensures CM does not allow the cursor inside this widget.
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

/**
 * Renders the human-readable filename of an image reference as ghost (muted italic)
 * text immediately after `![](img:<id>)` syntax in the editor.
 * eq() is implemented so CM can diff decorations and skip DOM updates when the name
 * hasn't changed.
 */
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

/**
 * Zero-width anchor widget injected in place of the ghost name while the user is
 * renaming an image. The rename input (in the Vue template) is positioned over this
 * anchor via getBoundingClientRect(), so it appears exactly where the ghost text would be.
 */
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
