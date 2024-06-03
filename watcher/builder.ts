import * as path from 'path'
import * as fs from 'fs'
import { parseMarkdown } from './markdown-parser'
import less from 'less'

async function compileLess() {
  try {
    const lessFilePath = path.join(process.cwd(), '.config', 'style.less')
    const lessContent = await fs.promises.readFile(lessFilePath, 'utf8')

    const output = await less.render(lessContent)
    console.log('LESS file successfully compiled to CSS.')

    return output.css
  } catch (error) {
    console.error('Error compiling LESS file:', error)
  }
}

async function getHeader() {
  const headFilePath = path.join(process.cwd(), '.config', 'head.html')
  return fs.promises.readFile(headFilePath, 'utf8')
}

let css = ''
let header = ''

export async function init() {
  css = await compileLess()
  header = await getHeader()
}

export async function buildHTML(
  filepath: string,
  markdownContent: string
): Promise<string> {
  let head =
    `<!DOCTYPE html><html><head>
      <title>temporary</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    ` + css
  '<style>\n' + header + '</style>\n</head>\n'
  let markdown = await parseMarkdown(filepath, markdownContent)

  return head + '<body>' + markdown + '</body></html>'
}
