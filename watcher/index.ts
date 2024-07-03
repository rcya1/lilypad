import * as fs from 'fs'
import * as chokidar from 'chokidar'
import recursive from 'recursive-readdir'
import * as path from 'path'
import * as puppeteer from 'puppeteer'

import { ensureDirectoryExist, getRenderedPath, relToAbs } from './helper'
import { buildHTML, init } from './builder'
import { checkLockFile, updateLockFile, HEARTBEAT_INTERVAL_MS } from './lock'
import { buildFs } from './fs'

async function generateHtml(
  sourcePath: string,
  renderedPath: string
): Promise<string> {
  let start = Date.now()
  let html = await buildHTML(
    sourcePath,
    await fs.readFileSync(sourcePath, 'utf8')
  )
  ensureDirectoryExist(renderedPath)
  fs.writeFileSync(renderedPath, html)

  console.log('Generated HTML for', sourcePath, 'in', Date.now() - start, 'ms')

  return html
}

async function generatePdf(
  html: string,
  sourcePath: string,
  renderedPath: string
) {
  let start = Date.now()
  let browser: any
  try {
    browser = await puppeteer.launch({
      pipe: true,
      args: ['--disable-gpu', '--no-sandbox', '--disable-extensions']
    })
    const page = await browser.newPage()

    // Set the content of the page to the HTML string
    await page.setContent(html, {
      waitUntil: 'domcontentloaded'
    })
    await page.evaluate(() => document.body.style.setProperty('zoom', '0.8'))
    ensureDirectoryExist(renderedPath)

    await page.pdf({
      path: renderedPath,
      format: 'A4',
      printBackground: true
    })
    console.log('Generated PDF for', sourcePath, 'in', Date.now() - start, 'ms')
  } catch (e) {
    console.error('\tError generating PDF', e)
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

async function renderFile(
  sourcePathRel: string,
  overrideIfExists = false,
  generatePdfs = false
) {
  const sourcePath = relToAbs(sourcePathRel)
  if (sourcePathRel.endsWith('.md')) {
    const renderedPathHtml = getRenderedPath(sourcePath, 'html')
    const renderedPathPdf = getRenderedPath(sourcePath, 'pdf')

    let html = ''
    if (!fs.existsSync(renderedPathHtml) || overrideIfExists) {
      html = await generateHtml(sourcePath, renderedPathHtml)
    }
    if ((!fs.existsSync(renderedPathPdf) || overrideIfExists) && generatePdfs) {
      if (!html) html = await fs.readFileSync(renderedPathHtml, 'utf8')
      await generatePdf(html, sourcePathRel, renderedPathPdf)
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
  const singleRun = process.argv.includes('--single-run')

  if (singleRun) {
    await init()
    console.log('Running a single pass')
    recursive('./src', function (_, files) {
      for (let file of files) {
        renderFile(file, false, true)
      }
      buildFs()
    })

    return
  }

  await checkLockFile()
  await updateLockFile()
  setInterval(updateLockFile, HEARTBEAT_INTERVAL_MS)

  await init()

  chokidar
    .watch('./src')
    .on('add', (sourcePathRel) => {
      renderFile(sourcePathRel)
      buildFs()
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
      buildFs()
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
        if (fs.existsSync(renderedPathHtml)) fs.unlinkSync(renderedPathHtml)
        if (fs.existsSync(renderedPathPdf)) fs.unlinkSync(renderedPathPdf)
        console.log('Deleted HTML and PDF for', sourcePathRel)
      } else if (path.dirname(sourcePathRel).endsWith('img')) {
        const absPath = relToAbs(sourcePathRel)
        const renderedPath = getRenderedPath(absPath)
        if (fs.existsSync(renderedPath)) fs.unlinkSync(renderedPath)
        console.log('Deleted', sourcePathRel)
      }
      buildFs()
    })
    .on('ready', () => {
      console.log('Watching for changes in ../src')
    })

  chokidar.watch('./.config').on('change', async (path) => {
    if (path.endsWith('lock')) {
      return
    }
    console.log('Detected change in config')
    await init()
  })
}

main()
