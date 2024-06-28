import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import fm from 'front-matter'
import { FrontMatter } from './frontmatter'

// TODO: active text editor should reveal the open file in the explorer
// Implement add file
// Updating a file should update just that folder's thing
// Drag and drop to reorder within folder
// Drag and drop to move between folders
export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  pathMap: Map<string, ExplorerNode>
  watcher: vscode.FileSystemWatcher

  constructor(private srcPath: string) {
    this.pathMap = new Map()
    let recurse = (pa: string, parent: ExplorerNode | undefined) => {
      let stats = fs.statSync(pa)
      let node = new ExplorerNode(
        path.basename(pa),
        stats.isDirectory()
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        pa,
        this.pathMap,
        parent
      )
      node.changed = () => {
        this._onDidChangeTreeData.fire(node)
      }
      if (!stats.isDirectory()) {
        return
      }

      fs.readdirSync(pa).forEach((name) => {
        recurse(path.join(pa, name), node)
      })
    }
    recurse(srcPath, undefined)

    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(srcPath, '**/*')
    )
    this.watcher.onDidCreate((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
      recurse(uri.fsPath, parent)
      this._onDidChangeTreeData.fire(parent)
    })
    this.watcher.onDidChange((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
      this._onDidChangeTreeData.fire(parent)
    })
    this.watcher.onDidDelete((uri) => {
      let parent = this.pathMap.get(path.dirname(uri.fsPath))
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
    console.log(path, this.pathMap)
    return this.pathMap.get(path)
  }
}

export class ExplorerNode extends vscode.TreeItem {
  changed: () => void = () => {}

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly path: string,
    pathMap: Map<String, ExplorerNode>,
    public readonly parent?: ExplorerNode
  ) {
    super(label, collapsibleState)
    let isFolder =
      this.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
    let icon = isFolder
      ? new vscode.ThemeIcon('folder', new vscode.ThemeColor('icon.foreground'))
      : vscode.ThemeIcon.File
    this.iconPath = icon
    this.resourceUri = vscode.Uri.file(this.path)
    this.command = isFolder
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
    fs.unlinkSync(this.path)
  }
}
