import * as fs from 'fs'
import * as path from 'path'

export function relToAbs(relPath: string) {
  return path.join(process.cwd(), relPath)
}

export function getRenderedPath(
  relPath: string,
  type: 'html' | 'pdf' | null = null
) {
  let res = relPath.replace(
    path.join(process.cwd(), 'src'),
    path.join(process.cwd(), 'rendered', type === null ? 'html' : type)
  )
  if (type) {
    res = res.replace('.md', `.${type}`)
  }

  return res
}

export function ensureDirectoryExist(filePath: string) {
  const dirname = path.dirname(filePath)
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true })
  }
}
