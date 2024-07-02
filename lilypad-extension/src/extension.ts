import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import fm from 'front-matter'
import { ExplorerNode, ExplorerProvider } from './explorer'
import { FrontMatter } from './frontmatter'

let HEARTBEAT_INTERVAL_THRESHOLD_MS = 2000 * 1.5
let TERMINAL_COOLDOWN_MS = 1000
let lastTimeOpened: Date | undefined = undefined

let panel: vscode.WebviewPanel | undefined = undefined
let associatedEditor: vscode.TextEditor | undefined = undefined
let fsWatcher: vscode.FileSystemWatcher | undefined = undefined
let compileTerminal: vscode.Terminal | undefined = undefined
let explorerProvider: ExplorerProvider | undefined = undefined
let treeView: vscode.TreeView<ExplorerNode> | undefined = undefined

async function checkLockFile() {
  let workspacePath = vscode.workspace.workspaceFolders?.[0].uri.fsPath
  if (!workspacePath) {
    vscode.window.showErrorMessage(
      'No workspace found to try to launch Lilypad compiler'
    )
    return false
  }
  const lockPath = path.join(workspacePath, '.config', 'lock')
  if (fs.existsSync(lockPath)) {
    const lockContent = await fs.promises.readFile(lockPath, 'utf8')
    const timestamp = new Date(lockContent.trim())
    if (Date.now() - timestamp.getTime() < HEARTBEAT_INTERVAL_THRESHOLD_MS) {
      return false
    }
  }

  return true
}

export function activate({
  subscriptions,
  extensionPath
}: vscode.ExtensionContext) {
  const rootPath =
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 0
      ? vscode.workspace.workspaceFolders[0].uri.fsPath
      : undefined
  if (rootPath) {
    let srcPath = path.join(rootPath, 'src')
    explorerProvider = new ExplorerProvider(srcPath)
    treeView = vscode.window.createTreeView('lilypad-extension-browser', {
      treeDataProvider: explorerProvider
    })
  }
  subscriptions.push(
    vscode.commands.registerCommand('lilypad-extension.togglePreview', () => {
      if (
        !lastTimeOpened ||
        Date.now() - lastTimeOpened.getTime() > TERMINAL_COOLDOWN_MS
      ) {
        lastTimeOpened = new Date()
        checkLockFile().then((shouldContinue) => {
          if (!shouldContinue) {
            return
          }
          if (compileTerminal) {
            compileTerminal.dispose()
            compileTerminal = undefined
          }

          compileTerminal = vscode.window.createTerminal('Compile Lilypad')
          compileTerminal.sendText('yarn run watch')
          vscode.window.showInformationMessage(
            'Running Lilypad compile watcher in background...'
          )
        })
      }

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

      changeToEditor(activeEditor, extensionPath)
    }),
    vscode.commands.registerCommand('lilypad-extension.refreshExplorer', () => {
      if (explorerProvider) {
        explorerProvider.refresh()
      }
    }),
    vscode.commands.registerCommand(
      'lilypad-extension.delete',
      (node: ExplorerNode) => {
        vscode.window
          .showWarningMessage(
            'Are you sure you want to delete?',
            { modal: true },
            'Yes',
            'No'
          )
          .then((value) => {
            if (value === 'Yes') {
              node.delete()
              if (
                vscode.window.activeTextEditor?.document.fileName === node.path
              ) {
                vscode.commands.executeCommand(
                  'workbench.action.closeActiveEditor'
                )
              }
            }
          })
      }
    ),
    vscode.commands.registerCommand(
      'lilypad-extension.addFile',
      (node?: ExplorerNode) => {
        let selectedNode = node
          ? node
          : treeView?.selection
          ? treeView.selection[0]
          : undefined
        if (selectedNode) {
          selectedNode.addFile()
        } else {
          explorerProvider?.getRoot()?.addFile()
        }
      }
    ),
    vscode.commands.registerCommand(
      'lilypad-extension.addFolder',
      async (node?: ExplorerNode) => {
        let selectedNode = node
          ? node
          : treeView?.selection
          ? treeView.selection[0]
          : undefined

        let folderNode
        if (selectedNode) {
          folderNode = await selectedNode.addFolder()
        } else {
          folderNode = await explorerProvider?.getRoot()?.addFolder()
        }
        if (folderNode) {
          await treeView?.reveal(folderNode, {
            select: false,
            focus: true,
            expand: true
          })
        }
      }
    ),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      // check if lilypad explorer is open
      if (!treeView?.visible) {
        return
      }

      let fsPath = editor?.document.uri.fsPath
      if (!fsPath) {
        return
      }
      let node = explorerProvider?.getNode(fsPath)
      if (!node) {
        return
      }
      treeView?.reveal(node)
    })
  )
}

function readAndProcessHtml(filePath: string) {
  // find all images in the html file
  let html = fs.readFileSync(filePath, 'utf8')
  const images = html.match(/<img[^>]+>/g)
  if (images) {
    images.forEach((image) => {
      const src = image.match(/src="([^"]+)"/)
      if (src) {
        const imagePath = path.join(path.dirname(filePath), src[1])
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
      let buffer = '';

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
        } else if (event.key === 'Enter') {
          if (buffer.slice(-2) === ':q') {
            const vscode = acquireVsCodeApi();
            vscode.postMessage('close');
          } else {
            buffer = '';
          }
        } else if (event.key.length === 1) {
          buffer += event.key;
        }
      });

      document.addEventListener('keyup', function(event) {
        if (event.key === 'Control') {
          ctrlPressed = false;
        }
      });
    </script>
  `
  return html.replace('</body>', `${script}</body>`)
}

function changeToEditor(editor: vscode.TextEditor, extensionPath: string) {
  const filePath = editor.document.fileName
  const fileName = path.parse(filePath).name

  const srcPattern = new RegExp(`\\${path.sep}src\\${path.sep}`)
  const htmlReplacement = `${path.sep}rendered${path.sep}html${path.sep}`

  const renderedPath = filePath
    .replace(srcPattern, htmlReplacement)
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
    panel.iconPath = {
      light: vscode.Uri.file(path.join(extensionPath, 'icon-light.svg')),
      dark: vscode.Uri.file(path.join(extensionPath, 'icon-dark.svg'))
    }
    changeActiveCallback = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        onChangeEditor(editor, extensionPath)
      }
    )
  } else {
    panel.title = fileName
  }

  associatedEditor = editor
  vscode.window.showTextDocument(
    associatedEditor.document,
    associatedEditor.viewColumn,
    false
  )

  let markdown = editor.document.getText()
  let frontMatter = fm<FrontMatter>(markdown, {
    allowUnsafe: true
  })
  panel.title = frontMatter.attributes.title || fileName
  panel.webview.html = readAndProcessHtml(renderedPath)
  let webviewListener = panel.webview.onDidReceiveMessage((message) => {
    switch (message) {
      case 'close':
        if (panel) {
          panel.dispose()
          if (associatedEditor) {
            vscode.window.showTextDocument(
              associatedEditor.document,
              associatedEditor.viewColumn,
              false
            )
          }
        }
        break
      default:
        break
    }
  })

  if (fsWatcher) {
    fsWatcher.dispose()
  }
  fsWatcher = vscode.workspace.createFileSystemWatcher(
    renderedPath,
    true,
    false,
    true
  )
  fsWatcher.onDidChange(() => {
    if (panel) {
      panel.webview.html = readAndProcessHtml(renderedPath)
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
    fsWatcher?.dispose()
    webviewListener.dispose()
    panel = undefined
    associatedEditor = undefined
    if (changeActiveCallback) {
      changeActiveCallback.dispose()
    }
  })
}

function onChangeEditor(
  editor: vscode.TextEditor | undefined,
  extensionPath: string
) {
  if (editor && editor.document.languageId === 'markdown') {
    changeToEditor(editor, extensionPath)
  }
}
