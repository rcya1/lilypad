const { Notebook } = require('crossnote')
const fs = require('fs')
const path = require('path')
const less = require('less')
const chokidar = require('chokidar')
const recursive = require('recursive-readdir')

async function compileLess() {
  try {
    const lessFilePath = path.join(__dirname, './.crossnote/style.less')
    const lessContent = await fs.promises.readFile(lessFilePath, 'utf8')

    const output = await less.render(lessContent)
    console.log('LESS file successfully compiled to CSS.')

    return output.css
  } catch (error) {
    console.error('Error compiling LESS file:', error)
  }
}

function relToAbs(relPath) {
  return path.join(__dirname, relPath)
}

function getRenderedPath(relPath, type = null) {
  let res = relPath.replace(
    path.join(__dirname, 'src'),
    path.join(__dirname, 'rendered', type === null ? 'html' : type)
  )
  if (type) {
    res = res.replace('.md', `.${type}`)
  }

  return res
}

function ensureDirectoryExist(filePath) {
  const dirname = path.dirname(filePath)
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true })
  }
}

async function generateHtml(engine, absPath, renderedPath) {
  engine
    .htmlExport({
      runAllCodeChunks: true,
      openFileAfterGeneration: false
    })
    .then(() => {
      console.log('HTML generated for', absPath)
      ensureDirectoryExist(renderedPath)
      fs.renameSync(absPath.replace('.md', '.html'), renderedPath)
    })
}

async function generatePdf(engine, absPath, renderedPath) {
  engine
    .chromeExport({
      fileType: 'pdf',
      runAllCodeChunks: true,
      openFileAfterGeneration: false
    })
    .then(() => {
      console.log('PDF generated for', absPath)
      ensureDirectoryExist(renderedPath)
      fs.renameSync(absPath.replace('.md', '.pdf'), renderedPath)
    })
}

async function handleFileAdd(notebook, relPath) {
  if (relPath.endsWith('.md')) {
    const absPath = relToAbs(relPath)
    const renderedPathHtml = getRenderedPath(absPath, 'html')
    const renderedPathPdf = getRenderedPath(absPath, 'pdf')

    const engine = notebook.getNoteMarkdownEngine(absPath)

    if (!fs.existsSync(renderedPathHtml)) {
      generateHtml(engine, absPath, renderedPathHtml)
    }

    if (!fs.existsSync(renderedPathPdf)) {
      generatePdf(engine, absPath, renderedPathPdf)
    }
  } else if (path.dirname(relPath).endsWith('img')) {
    const absPath = relToAbs(relPath)
    const renderedPath = getRenderedPath(absPath)
    ensureDirectoryExist(renderedPath)
    if (!fs.existsSync(renderedPath)) {
      fs.copyFileSync(absPath, renderedPath)
      console.log('Copying', relPath)
    }
  }
}

async function main() {
  const singleRun = process.argv.includes('--single-run')

  // Read the content of .crossnote/head.html
  const headFilePath = path.join(__dirname, '.crossnote/head.html')
  const includeInHeader =
    (await fs.promises.readFile(headFilePath, 'utf8')) +
    '<style>' +
    (await compileLess()) +
    '</style>'

  const notebook = await Notebook.init({
    notebookDir: '/Users/rcya/Desktop/lilypad',
    config: {
      includeInHeader: includeInHeader
    }
  })

  if (singleRun) {
    console.log('Running a single pass')
    recursive('./src', function (err, files) {
      for (let file of files) {
        handleFileAdd(notebook, file)
      }
    })

    return
  }

  chokidar
    .watch('./src')
    .on('add', (relPath) => {
      handleFileAdd(notebook, relPath)
    })
    .on('addDir', (relPath) => {
      if (!relPath.endsWith('img')) {
        return
      }

      const absPath = relToAbs(relPath)
      const renderedPath = getRenderedPath(absPath)
      ensureDirectoryExist(renderedPath + '/random.png')

      fs.readdirSync(absPath).forEach((file) => {
        const absFilePath = path.join(absPath, file)
        const renderedFilePath = path.join(renderedPath, file)
        if (!fs.existsSync(renderedFilePath)) {
          fs.copyFileSync(absFilePath, renderedFilePath)
          console.log('Copying', path.join(relPath, file))
        }
      })
    })
    .on('change', (relPath) => {
      const absPath = relToAbs(relPath)
      const renderedPathHtml = getRenderedPath(absPath, 'html')
      const renderedPathPdf = getRenderedPath(absPath, 'pdf')

      const engine = notebook.getNoteMarkdownEngine(absPath)
      console.log('Detected change in', absPath, '(re-generating HTML and PDF)')
      generateHtml(engine, absPath, renderedPathHtml)
      generatePdf(engine, absPath, renderedPathPdf)
    })
    .on('unlink', (relPath) => {
      if (relPath.endsWith('.md')) {
        const absPath = relToAbs(relPath)
        const renderedPathHtml = getRenderedPath(absPath, 'html')
        const renderedPathPdf = getRenderedPath(absPath, 'pdf')
        fs.unlinkSync(renderedPathHtml)
        fs.unlinkSync(renderedPathPdf)
        console.log('Deleted HTML and PDF for', relPath)
      } else if (path.dirname(relPath).endsWith('img')) {
        const absPath = relToAbs(relPath)
        const renderedPath = getRenderedPath(absPath)
        fs.unlinkSync(renderedPath)
        console.log('Deleted', relPath)
      }
    })
    .on('ready', () => {
      console.log('Watching for changes in ./src')
    })
}

main()
