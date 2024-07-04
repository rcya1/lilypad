import * as fs from 'fs'
import * as path from 'path'
import fm from 'front-matter'

type FrontMatter = {
  title: string | undefined
  date: Date | undefined
  order: number | undefined
}

export function buildFs() {
  let outputFile = './browser/src/assets/fs.json'

  // @ts-ignore
  let recurse = (p: string) => {
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
      return {
        id: id,
        name: info.name,
        // @ts-ignore
        children: children
          .map((child) => recurse(path.join(p, child)))
          .filter((child) => child)
      }
    }
  }
  let data = recurse('./src/').children

  fs.writeFileSync(outputFile, JSON.stringify(data))
  console.log('fs.json updated for browser')
}
