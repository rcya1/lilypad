import { Marked } from 'marked'
import markedKatex from 'marked-katex-extension'
import * as path from 'path'
import * as fs from 'fs'
import sizeOf from 'image-size'

async function getKatexMacros() {
  const configFilePath = path.join(process.cwd(), '.config', 'macros.json')
  const configContent = await fs.promises.readFile(configFilePath, 'utf8')
  const config = JSON.parse(configContent)

  return config
}

const admonition = {
  name: 'admonition',
  level: 'block',
  start(src: string) {
    return src.match(/\|\|/)?.index
  },
  tokenizer(src: string, tokens: any[]) {
    const rule = /^\|\|([\s\S]*?)\|\|/
    const match = rule.exec(src)
    if (match) {
      let text = match[0].trim()
      let firstLine = text.split('\n')[0].replace(/\|\|/g, '').trim()
      let type = firstLine.split(' ')[0]
      let title = firstLine.replace(type, '').trim()
      let body = text.replace(firstLine, '').replace(/\|\|/g, '').trim()

      if (['proposition'].includes(type)) {
        title = 'Proposition: ' + title
      }

      const token = {
        type: 'admonition',
        raw: match[0],
        body,
        title,
        admonitionType: type,
        tokens: Array<string>()
      }
      this.lexer.blockTokens(token.body, token.tokens)
      return token
    }
  },
  renderer(token: any) {
    let icon = ''
    switch (token.admonitionType) {
      case 'info':
        icon = '<i class="fa fa-info-circle"></i>'
        break
      case 'definition':
      case 'proposition':
        icon = '<i class="fa fa-book"></i>'
        break
    }

    let output = `<div class="admonition ${token.admonitionType}">
      <div class="title">
        ${icon + token.title}
      </div>
      <div class="body">
        ${this.parser.parse(token.tokens)}
      </div>
    </div>`
    return output
  }
}

const images = (filepath: string) => {
  return {
    renderer: {
      image(href: string, title: string, text: string) {
        let actualHref
        let style = ''

        if (href.includes('?')) {
          actualHref = href.split('?')[0]
          let params = href.split('?')[1].split('&')

          for (let param of params) {
            let [key, value] = param.split('=')
            if (key === 'maxw') {
              style += `max-width: ${value}px;`
            }
          }
        } else {
          actualHref = href
        }
        return `<img style="${style}" src="${actualHref}"/>`
      }
    },
    async: true,
    async walkTokens(token: any) {
      if (token.type === 'image' && token.href.includes('?')) {
        let params = token.href.split('?')[1].split('&')
        let newParams = []
        for (let param of params) {
          let [key, value] = param.split('=')
          if (key === 'maxwx') {
            let actualHref = token.href.split('?')[0]
            let imageDims = await sizeOf(
              path.join(path.dirname(filepath), actualHref)
            )
            let width = imageDims.width
            newParams.push(`maxw=${Math.round(width * parseFloat(value))}`)
          } else {
            newParams.push(param)
          }
        }
        token.href = token.href.split('?')[0] + '?' + newParams.join('&')
      }
    }
  }
}

export async function parseMarkdown(
  filepath: string,
  content: string
): Promise<string> {
  // ignore front matter
  if (content.startsWith('---')) {
    content = content.split('---').slice(2).join('---')
  }
  const marked = new Marked()
  let katexExtension = markedKatex({
    throwOnError: false,
    macros: await getKatexMacros()
  })
  marked.use(katexExtension)
  marked.use({ extensions: [admonition] })
  marked.use(images(filepath))
  return await marked.parse(content, {
    breaks: true
  })
}
