import * as fs from 'fs'
import * as path from 'path'
import fm from 'front-matter'

type FrontMatter = {
  title: string | undefined
  date: Date | undefined
  order: number | undefined
}

interface Node {
  id: string
  name: string
  order?: number
  date?: Date
  children?: Node[]
}

export function buildFs() {
  let outputFile = './browser/src/assets/fs.json'

  // @ts-ignore
  function recurse(p: string): Node {
    let id = p.split(path.sep).join(path.posix.sep)
    id = id.replace('src/', '')
    let stat = fs.statSync(p)
    if (!stat.isDirectory()) {
      if (!p.endsWith('.md')) return
      // get front matter
      let content = fs.readFileSync(p, 'utf8')
      let frontMatter = content
        ? fm<FrontMatter>(content, {
            allowUnsafe: true
          })
        : {
            // @ts-ignore
            attributes: { title: undefined, date: undefined, order: undefined }
          }
      return {
        order: frontMatter.attributes.order,
        date: frontMatter.attributes.date,
        id: id,
        name: frontMatter.attributes.title ? frontMatter.attributes.title : p
      }
    } else {
      if (p.endsWith('img')) return
      let children = fs.readdirSync(p)
      let info =
        p == './src/'
          ? {}
          : JSON.parse(fs.readFileSync(path.join(p, 'info.json'), 'utf-8'))
      let childrenNodes = children
        .map((child) => recurse(path.join(p, child)))
        .filter((child) => child)
      childrenNodes.sort((a, b) => {
        let res0
        if (a.order && b.order) {
          res0 = a.order - b.order
        } else if (a.order) {
          res0 = -1
        } else if (b.order) {
          res0 = 1
        }
        if (res0 !== undefined) {
          return res0
        }
        let res1
        if (a.date && b.date) {
          res1 = a.date.getTime() - b.date.getTime()
        } else if (a.date) {
          res1 = -1
        } else if (b.date) {
          res1 = 1
        }
        if (res1 !== undefined) {
          return res1
        }
        return a.id.localeCompare(b.id)
      })
      return {
        id: id,
        name: info.name,
        // @ts-ignore
        children: childrenNodes
      }
    }
  }
  let data = recurse('./src/').children

  fs.writeFileSync(outputFile, JSON.stringify(data))
  console.log('fs.json updated for browser')
}
