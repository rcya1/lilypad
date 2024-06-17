import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'

let panel: vscode.WebviewPanel | undefined = undefined
let associatedEditor: vscode.TextEditor | undefined = undefined
let watcher: vscode.FileSystemWatcher | undefined = undefined

export function activate({ subscriptions }: vscode.ExtensionContext) {
  subscriptions.push(
    vscode.commands.registerCommand('lilypad-extension.togglePreview', () => {
      if (panel) {
        if (panel.active) {
          if (associatedEditor) {
            vscode.window.showTextDocument(
              associatedEditor.document,
              associatedEditor.viewColumn,
              false
            )
          }
          return
        } else if (vscode.window.activeTextEditor === associatedEditor) {
          panel.reveal(vscode.ViewColumn.Beside, false)
          return
        }
      }

      const activeEditor = vscode.window.activeTextEditor

      if (!activeEditor) {
        vscode.window.showInformationMessage('No active editor found!')
        return
      }

      if (activeEditor.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage(
          'Active editor is not a markdown file!'
        )
        return
      }

      changeToEditor(activeEditor)
    })
  )
}

function changeToEditor(editor: vscode.TextEditor) {
  const filePath = editor.document.fileName
  const fileName = path.parse(filePath).name

  const renderedPath = filePath
    .replace(/\/src\//, '/rendered/html/')
    .replace(/\.md$/, '.html')

  if (!fs.existsSync(renderedPath)) {
    vscode.window.showInformationMessage('No rendered HTML file found.')
    return
  }

  let changeActiveCallback: vscode.Disposable | undefined
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      'htmlPreview',
      fileName,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true
      }
    )
    changeActiveCallback =
      vscode.window.onDidChangeActiveTextEditor(onChangeEditor)
  } else {
    panel.title = fileName
  }

  associatedEditor = editor
  vscode.window.showTextDocument(
    associatedEditor.document,
    associatedEditor.viewColumn,
    false
  )

  // find all images in the html file
  let html = fs.readFileSync(renderedPath, 'utf8')
  const images = html.match(/<img[^>]+>/g)
  if (images) {
    images.forEach((image) => {
      const src = image.match(/src="([^"]+)"/)
      if (src) {
        const imagePath = path.join(path.dirname(renderedPath), src[1])
        if (fs.existsSync(imagePath)) {
          const webviewUri = panel?.webview.asWebviewUri(
            vscode.Uri.file(imagePath)
          )

          if (webviewUri) {
            html = html.replace(src[1], webviewUri.toString())
          } else {
            vscode.window.showInformationMessage(
              'Could not convert image to webview URI.'
            )
          }
        } else {
          vscode.window.showInformationMessage('Image not found.')
        }
      }
    })
  }
  let script = `
    <script>
      let gPressedOnce = false; // To detect double 'g' press for top scroll
      let ctrlPressed = false; // To detect if ctrl is pressed for zooming

      document.addEventListener('keydown', function(event) {
        const scrollAmount = 40;

        if (event.key === 'j') {
          window.scrollBy(0, scrollAmount);
        } else if (event.key === 'k') {
          window.scrollBy(0, -scrollAmount);
        } else if (event.key === 'g') {
          if (gPressedOnce) {
            window.scrollTo(0, 0);
            gPressedOnce = false;
          } else {
            gPressedOnce = true;
            setTimeout(() => {
              gPressedOnce = false; // Reset after 1 second if no second 'g' is pressed
            }, 1000);
          }
        } else if (event.key === 'G') {
          window.scrollTo(0, document.body.scrollHeight);
        } else if (event.key === 'Control') {
          ctrlPressed = true;
        } else if (event.key === 'd' && ctrlPressed) {
          window.scrollBy(0, window.innerHeight / 2);
        } else if (event.key === 'u' && ctrlPressed) {
          window.scrollBy(0, -window.innerHeight / 2);
        }
      });

      document.addEventListener('keyup', function(event) {
        if (event.key === 'Control') {
          ctrlPressed = false;
        }
      });
    </script>
  `
  html = html.replace('</body>', `${script}</body>`)
  panel.webview.html = html

  if (watcher) {
    watcher.dispose()
  }
  watcher = vscode.workspace.createFileSystemWatcher(
    renderedPath,
    true,
    false,
    true
  )
  watcher.onDidChange(() => {
    if (panel) {
      panel.webview.html = fs.readFileSync(renderedPath, 'utf8')
    }
  })
  panel.onDidChangeViewState(({ webviewPanel }) => {
    vscode.commands.executeCommand(
      'setContext',
      'lilypad-extension.previewFocused',
      webviewPanel.active
    )
  })

  panel.onDidDispose(() => {
    vscode.commands.executeCommand(
      'setContext',
      'lilypad-extension.previewFocused',
      false
    )
    watcher?.dispose()
    panel = undefined
    associatedEditor = undefined
    if (changeActiveCallback) {
      changeActiveCallback.dispose()
    }
  })
}

function onChangeEditor(editor: vscode.TextEditor | undefined) {
  if (editor && editor.document.languageId === 'markdown') {
    changeToEditor(editor)
  }
}

// TODO: add shortcuts to the webview so you can scroll up and down with j and k
