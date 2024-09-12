import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import fm from 'front-matter'
import { FrontMatter } from './frontmatter'

// TODO:
// Drag and drop to reorder within folder
// Drag and drop to move between folders
export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  rootNode: ExplorerNode
  pathMap: Map<string, ExplorerNode>
  watcher: vscode.FileSystemWatcher
  recurse: (pa: string, parent: ExplorerNode | undefined) => ExplorerNode

  constructor(private srcPath: string) {
    this.pathMap = new Map()
    this.recurse = (pa: string, parent: ExplorerNode | undefined) => {
      let stats = fs.statSync(pa)
      let node = new ExplorerNode(
        path.basename(pa),
        stats.isDirectory()
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        pa,
        this.pathMap,
        this.recurse,
        parent
      )
      node.changed = () => {
        this._onDidChangeTreeData.fire(node)
      }
      if (!stats.isDirectory()) {
        return node
      }

      fs.readdirSync(pa).forEach((name) => {
        this.recurse(path.join(pa, name), node)
      })

      return node
    }
    this.rootNode = this.recurse(srcPath, undefined)

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(srcPath, '**/*')
    )
    this.watcher.onDidCreate((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
      this.recurse(uri.fsPath, parent)
      if (parent === this.rootNode) {
        parent = undefined
      }
      this._onDidChangeTreeData.fire(parent)
    })
    this.watcher.onDidChange((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
      if (parent === this.rootNode) {
        parent = undefined
      }
      this._onDidChangeTreeData.fire(parent)
    })
    this.watcher.onDidDelete((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
      if (parent === this.rootNode) {
        parent = undefined
      }
      this._onDidChangeTreeData.fire(parent)
    })
  }

  getTreeItem(element: ExplorerNode): vscode.TreeItem {
    return element
  }

  getChildren(element?: ExplorerNode): Thenable<ExplorerNode[]> {
    if (!this.srcPath) {
      vscode.window.showErrorMessage('No source folder for Lilypad browser')
      return Promise.resolve([])
    }

    let elementPath = element ? element.path : this.srcPath
    let stats = fs.statSync(elementPath)
    if (!stats.isDirectory()) {
      return Promise.resolve([])
    }
    let folders: string[] = []
    let childrenFiles: [number | undefined, Date | undefined, string][] = []
    fs.readdirSync(elementPath).forEach((name) => {
      if (name.endsWith('.DS_Store')) {
        return
      }
      if (name.endsWith('.git')) {
        return
      }
      let p = path.join(elementPath, name)
      let stat = fs.statSync(p)
      if (stat.isDirectory()) {
        folders.push(p)
        return
      }
      let fileContents = fs.readFileSync(p, 'utf8')
      let frontMatter = fileContents
        ? fm<FrontMatter>(fileContents, {
            allowUnsafe: true
          })
        : {
            attributes: { title: undefined, date: undefined, order: undefined }
          }
      if (!(typeof frontMatter.attributes.order === 'number')) {
        frontMatter.attributes.order = undefined
      }
      if (!(typeof frontMatter.attributes.date === 'object')) {
        frontMatter.attributes.date = undefined
      }
      childrenFiles.push([
        frontMatter.attributes.order,
        frontMatter.attributes.date,
        p
      ])
    })
    childrenFiles.sort((a, b) => {
      let res0
      if (a[0] && b[0]) {
        res0 = a[0] - b[0]
      } else if (a[0]) {
        res0 = -1
      } else if (b[0]) {
        res0 = 1
      }
      if (res0 !== undefined) {
        return res0
      }
      let res1
      if (a[1] && b[1]) {
        res1 = a[1].getTime() - b[1].getTime()
      } else if (a[1]) {
        res1 = -1
      } else if (b[1]) {
        res1 = 1
      }
      if (res1 !== undefined) {
        return res1
      }
      return a[2].localeCompare(b[2])
    })
    return Promise.resolve(
      folders
        .map((p) => {
          return this.pathMap.get(p)
        })
        .concat(
          childrenFiles.map((info) => {
            let [_date, _order, p] = info
            return this.pathMap.get(p)
          })
        )
        .filter((n) => n !== undefined) as ExplorerNode[]
    )
  }

  private _onDidChangeTreeData = new vscode.EventEmitter<
    ExplorerNode | undefined | null | void
  >()
  readonly onDidChangeTreeData: vscode.Event<
    ExplorerNode | undefined | null | void
  > = this._onDidChangeTreeData.event

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  getParent(element: ExplorerNode): vscode.ProviderResult<ExplorerNode> {
    return element.parent
  }

  getNode(path: string): ExplorerNode | undefined {
    return this.pathMap.get(path)
  }

  getRoot(): ExplorerNode {
    return this.rootNode
  }
}

export class ExplorerNode extends vscode.TreeItem {
  isFolder: boolean
  changed: () => void = () => {}

  constructor(
    public label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public path: string,
    public readonly pathMap: Map<String, ExplorerNode>,
    public readonly recurse: (
      pa: string,
      parent: ExplorerNode | undefined
    ) => ExplorerNode,
    public readonly parent?: ExplorerNode
  ) {
    super(label, collapsibleState)
    this.isFolder =
      this.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
    let icon = this.isFolder
      ? new vscode.ThemeIcon('folder', new vscode.ThemeColor('icon.foreground'))
      : vscode.ThemeIcon.File
    this.iconPath = icon
    this.resourceUri = vscode.Uri.file(this.path)
    this.command = this.isFolder
      ? undefined
      : {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(this.path)]
        }

    pathMap.set(path, this)
  }

  setChanged(changed: () => void) {
    this.changed = changed
  }

  delete() {
    fs.rmSync(this.path, {
      recursive: true
    })
  }

  async rename(newName: string) {
    let oldPath = this.path
    let newPath = path.join(path.dirname(this.path), newName)
    fs.renameSync(oldPath, newPath)
    this.label = newName
    this.path = newPath
    this.resourceUri = vscode.Uri.file(newPath)
    this.changed()

    let newPathMap = new Map()
    this.pathMap.forEach((node, path) => {
      newPathMap.set(path.replace(oldPath, newPath), node)
    })
    this.pathMap.clear()
    newPathMap.forEach((node, path) => {
      this.pathMap.set(path, node)
    })

    // open the file in the editor
    let doc = await vscode.workspace.openTextDocument(newPath)
    await vscode.window.showTextDocument(doc)
  }

  async addFile() {
    let folderPath = this.isFolder ? this.path : this.parent?.path
    if (!folderPath) {
      return
    }

    // create file in the file path corresponding to path
    let name = await vscode.window.showInputBox({ prompt: 'Enter file name' })
    if (!name) {
      return
    }
    if (!name.endsWith('.md')) {
      name += '.md'
    }

    const currentDate = new Date()
    const year = currentDate.getFullYear()
    const month = String(currentDate.getMonth() + 1).padStart(2, '0')
    const day = String(currentDate.getDate()).padStart(2, '0')

    const formattedDate = `${year}-${month}-${day}`

    // read all md files in the folder, get the order in the front matter of each of them, and 1 + the max order
    let order = 1
    fs.readdirSync(folderPath).forEach((name) => {
      let p = path.join(folderPath, name)
      let stat = fs.statSync(p)
      if (stat.isDirectory()) {
        return
      }
      let fileContents = fs.readFileSync(p, 'utf8')
      let frontMatter = fileContents
        ? fm<FrontMatter>(fileContents, {
            allowUnsafe: true
          })
        : {
            attributes: { title: undefined, date: undefined, order: undefined }
          }
      if (typeof frontMatter.attributes.order === 'number') {
        order = Math.max(order, frontMatter.attributes.order + 1)
      }
    })

    let fileContents = `---
title: ${formatName(name.replace('.md', ''))}
date: ${formattedDate}
order: ${order}
---
`

    fs.writeFile(path.join(folderPath, name), fileContents, (err) => {
      if (err) {
        vscode.window.showErrorMessage('Error creating file: ' + err)
      }
    })

    // open the file in the editor
    let doc = await vscode.workspace.openTextDocument(
      path.join(folderPath, name)
    )
    await vscode.window.showTextDocument(doc)
  }

  async addFolder() {
    let folderPath = this.isFolder ? this.path : this.parent?.path
    if (!folderPath) {
      return
    }

    let name = await vscode.window.showInputBox({ prompt: 'Enter folder name' })
    if (!name) {
      return
    }

    fs.mkdirSync(path.join(folderPath, name))
    fs.writeFileSync(
      path.join(folderPath, name, 'info.json'),
      `
{
  "name": "${formatName(name)}",
  "description": "TODO"
}
`
    )
    let parent = this.pathMap.get(folderPath)
    this.recurse(path.join(folderPath, name), parent)
    parent?.changed()
    let node = this.pathMap.get(path.join(folderPath, name))
    return node
  }
}

function formatName(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
