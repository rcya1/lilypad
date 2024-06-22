import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import fm from 'front-matter'
import { FrontMatter } from './frontmatter'

export class ExplorerProvider implements vscode.TreeDataProvider<Node> {
  constructor(private srcPath: string) {}

  getTreeItem(element: Node): vscode.TreeItem {
    return element
  }

  getChildren(element?: Node): Thenable<Node[]> {
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
    let childrenFiles: [string | undefined, string | undefined, string][] = []
    fs.readdirSync(elementPath).forEach((name) => {
      let p = path.join(elementPath, name)
      let stat = fs.statSync(p)
      if (stat.isDirectory()) {
        folders.push(p)
        return
      }
      let fileContents = fs.readFileSync(p, 'utf8')
      let frontMatter = fileContents
        ? fm<FrontMatter>(fileContents)
        : {
            attributes: { title: undefined, date: undefined, order: undefined }
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
        res0 = a[0].localeCompare(b[0])
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
        res1 = a[1].localeCompare(b[1])
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
    console.log(childrenFiles)
    return Promise.resolve(
      folders
        .map((p) => {
          return new Node(
            path.basename(p),
            vscode.TreeItemCollapsibleState.Collapsed,
            p
          )
        })
        .concat(
          childrenFiles.map((info) => {
            let [_date, _order, p] = info
            return new Node(
              path.basename(p),
              vscode.TreeItemCollapsibleState.None,
              p
            )
          })
        )
    )
  }
}

class Node extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly path: string
  ) {
    super(label, collapsibleState)
    let isFolder =
      this.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed
    this.iconPath = isFolder ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File
    this.command = isFolder
      ? undefined
      : {
          command: 'vscode.open',
          title: 'Open File',
          arguments: [vscode.Uri.file(this.path)]
        }
  }
}

// TODO: make the icons look nicer, add a refresh button
