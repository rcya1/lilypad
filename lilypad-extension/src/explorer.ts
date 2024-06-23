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
  constructor(private srcPath: string) {}

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
      console.log(a[0], b[0], typeof a[0], typeof b[0])
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
          let node = new ExplorerNode(
            path.basename(p),
            vscode.TreeItemCollapsibleState.Collapsed,
            p,
            element
          )

          node.changed = () => {
            this._onDidChangeTreeData.fire(node)
          }

          return node
        })
        .concat(
          childrenFiles.map((info) => {
            let [_date, _order, p] = info
            let node = new ExplorerNode(
              path.basename(p),
              vscode.TreeItemCollapsibleState.None,
              p,
              element
            )

            node.changed = () => {
              this._onDidChangeTreeData.fire(node)
            }

            return node
          })
        )
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
}

export class ExplorerNode extends vscode.TreeItem {
  changed: () => void = () => {}

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly path: string,
    private readonly parent?: ExplorerNode
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
  }

  setChanged(changed: () => void) {
    this.changed = changed
  }

  delete() {
    fs.unlinkSync(this.path)
    if (this.parent) {
      this.parent.changed()
    }
  }
}
