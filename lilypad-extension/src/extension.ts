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
          panel.dispose()
          if (associatedEditor) {
            vscode.window.showTextDocument(
              associatedEditor.document,
              associatedEditor.viewColumn,
              false
            )
            associatedEditor = undefined
          }
          panel = undefined
        } else {
          panel.reveal(vscode.ViewColumn.Beside, false)
        }
        return
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

      const filePath = activeEditor.document.fileName
      const fileName = path.parse(filePath).name

      const renderedPath = filePath
        .replace(/\/src\//, '/rendered/html/')
        .replace(/\.md$/, '.html')

      if (!fs.existsSync(renderedPath)) {
        vscode.window.showInformationMessage('No rendered HTML file found.')
        return
      }

      panel = vscode.window.createWebviewPanel(
        'htmlPreview',
        fileName,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true
        }
      )
      associatedEditor = activeEditor
      panel.webview.html = fs.readFileSync(renderedPath, 'utf8')

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
      })
    })
  )
}
// TODO: when changing editor focus, it should display from the new one
// TODO: make images work
