import * as fs from 'fs'
import * as chokidar from 'chokidar'
import recursive from 'recursive-readdir'
import * as path from 'path'
import * as puppeteer from 'puppeteer'

import { ensureDirectoryExist, getRenderedPath, relToAbs } from './helper'
import { buildHTML, init } from './builder'

async function generateHtml(
  sourcePath: string,
  renderedPath: string
): Promise<string> {
  let html = await buildHTML(
    sourcePath,
    await fs.readFileSync(sourcePath, 'utf8')
  )
  ensureDirectoryExist(renderedPath)
  fs.writeFileSync(renderedPath, html)

  return html
}

async function generatePdf(html: string, renderedPath: string) {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  // Set the content of the page to the HTML string
  await page.setContent(html, {
    waitUntil: 'domcontentloaded'
  })
  ensureDirectoryExist(renderedPath)

  await page.pdf({
    path: renderedPath,
    format: 'A4',
    printBackground: true
  })

  await browser.close()
}

async function renderFile(sourcePathRel: string, overrideIfExists = false) {
  const sourcePath = relToAbs(sourcePathRel)
  if (sourcePathRel.endsWith('.md')) {
    const renderedPathHtml = getRenderedPath(sourcePath, 'html')
    const renderedPathPdf = getRenderedPath(sourcePath, 'pdf')

    if (!fs.existsSync(renderedPathHtml) || overrideIfExists) {
      let html = await generateHtml(sourcePath, renderedPathHtml)
      generatePdf(html, renderedPathPdf)
    }
  } else if (path.dirname(sourcePathRel).endsWith('img')) {
    const renderedPath = getRenderedPath(sourcePath)
    ensureDirectoryExist(renderedPath)

    if (!fs.existsSync(renderedPath)) {
      fs.copyFileSync(sourcePath, renderedPath)
      console.log('Copying', sourcePath)
    }
  }
}

async function main() {
  await init()

  const singleRun = process.argv.includes('--single-run')

  if (singleRun) {
    console.log('Running a single pass')
    recursive('./src', function (_, files) {
      for (let file of files) {
        renderFile(file)
      }
    })

    return
  }

  chokidar
    .watch('./src')
    .on('add', (sourcePathRel) => {
      renderFile(sourcePathRel)
    })
    .on('addDir', (sourcePathRel) => {
      if (!sourcePathRel.endsWith('img')) {
        return
      }

      const absPath = relToAbs(sourcePathRel)
      const renderedPath = getRenderedPath(absPath)
      ensureDirectoryExist(renderedPath + '/random.png')

      fs.readdirSync(absPath).forEach((file) => {
        const absFilePath = path.join(absPath, file)
        const renderedFilePath = path.join(renderedPath, file)
        if (!fs.existsSync(renderedFilePath)) {
          fs.copyFileSync(absFilePath, renderedFilePath)
          console.log('Copying', path.join(sourcePathRel, file))
        }
      })
    })
    .on('change', (sourcePathRel) => {
      console.log(
        'Detected change in',
        sourcePathRel,
        '(re-generating HTML and PDF)'
      )
      renderFile(sourcePathRel, true)
    })
    .on('unlink', (sourcePathRel) => {
      if (sourcePathRel.endsWith('.md')) {
        const absPath = relToAbs(sourcePathRel)
        const renderedPathHtml = getRenderedPath(absPath, 'html')
        const renderedPathPdf = getRenderedPath(absPath, 'pdf')
        fs.unlinkSync(renderedPathHtml)
        fs.unlinkSync(renderedPathPdf)
        console.log('Deleted HTML and PDF for', sourcePathRel)
      } else if (path.dirname(sourcePathRel).endsWith('img')) {
        const absPath = relToAbs(sourcePathRel)
        const renderedPath = getRenderedPath(absPath)
        fs.unlinkSync(renderedPath)
        console.log('Deleted', sourcePathRel)
      }
    })
    .on('ready', () => {
      console.log('Watching for changes in ../src')
    })

  chokidar.watch('./.config').on('change', async () => {
    console.log('Detected change in config')
  })
}

main()
