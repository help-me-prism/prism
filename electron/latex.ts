import { promises as fs } from 'node:fs'
import path from 'node:path'

export type LatexBlock = {
  id: string
  kind: 'heading' | 'paragraph' | 'caption' | 'equation' | 'figure' | 'table'
  source: string
  section?: string
}

export type LatexStructure = {
  version: 2
  rootFile: string
  generatedAt: string
  blocks: LatexBlock[]
}

async function texFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await texFiles(absolute))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.tex')) result.push(absolute)
  }
  return result
}

function stripComments(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/(^|[^\\])%.*/, '$1')).join('\n')
}

async function expandInputs(file: string, sourceRoot: string, seen = new Set<string>()): Promise<string> {
  const resolved = path.resolve(file)
  if (seen.has(resolved) || !resolved.startsWith(`${path.resolve(sourceRoot)}${path.sep}`) && resolved !== path.resolve(sourceRoot)) return ''
  seen.add(resolved)
  let content = stripComments(await fs.readFile(resolved, 'utf8'))
  const includes = [...content.matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)]
  for (const match of includes) {
    const requested = match[1].trim().replace(/\\/g, '/')
    if (!requested || requested.includes('..')) { content = content.replace(match[0], ''); continue }
    const candidate = path.resolve(path.dirname(resolved), requested.toLowerCase().endsWith('.tex') ? requested : `${requested}.tex`)
    let replacement = ''
    if (candidate.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
      try { replacement = await expandInputs(candidate, sourceRoot, seen) } catch { /* optional include */ }
    }
    content = content.replace(match[0], replacement)
  }
  return content
}

function commandArgument(value: string, command: string) {
  const match = value.match(new RegExp(`\\\\${command}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1]?.trim()
}

function latexToPlain(value: string) {
  let plain = value
    .replace(/\\(?:begin|end)\s*\{[^}]+\}/g, ' ')
    .replace(/\\(?:label|bibliography|bibliographystyle)\s*\{[^}]*\}/g, ' ')
    .replace(/\\(?:cite\w*|ref|eqref|autoref)\s*\{([^}]*)\}/g, '[$1]')
    .replace(/\\(?:emph|textbf|textit|textrm|texttt|underline)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:footnote)\s*\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\(?:newline|linebreak|par)\b/g, '\n')
    .replace(/\\(?:vspace|hspace)\*?\s*\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  plain = plain.replace(/\s+([,.;:!?])/g, '$1')
  return plain
}

function environmentKind(name: string): LatexBlock['kind'] {
  if (/^(?:equation|align|gather|multline|displaymath|eqnarray)/.test(name)) return 'equation'
  if (/^figure/.test(name)) return 'figure'
  return 'table'
}

export async function parseLatexStructure(sourceDir: string): Promise<LatexStructure | null> {
  let files: string[]
  try { files = await texFiles(sourceDir) } catch { return null }
  if (!files.length) return null
  const candidates = await Promise.all(files.map(async (file) => ({ file, text: await fs.readFile(file, 'utf8') })))
  const root = candidates.filter((candidate) => /\\begin\s*\{document\}/.test(candidate.text))
    .sort((left, right) => right.text.length - left.text.length)[0] ?? candidates.sort((left, right) => right.text.length - left.text.length)[0]
  let content = await expandInputs(root.file, sourceDir)
  const documentStart = content.search(/\\begin\s*\{document\}/)
  if (documentStart >= 0) content = content.slice(documentStart).replace(/^.*?\\begin\s*\{document\}/s, '')
  content = content.replace(/\\end\s*\{document\}[\s\S]*$/, '')
  content = content.replace(/\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/g, '\n\n\\section*{Abstract}\n\n$1\n\n')

  const protectedBlocks: LatexBlock[] = []
  const protect = (kind: LatexBlock['kind'], source: string) => {
    const id = `latex-${protectedBlocks.length + 1}`
    protectedBlocks.push({ id, kind, source: source.trim() })
    return `\n\n@@${id}@@\n\n`
  }
  const environment = /\\begin\s*\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath|eqnarray\*?|figure\*?|table\*?|tabular\*?|longtable)\}([\s\S]*?)\\end\s*\{\1\}/g
  content = content.replace(environment, (_whole, name: string, body: string) => {
    const kind = environmentKind(name)
    if (kind === 'figure' || kind === 'table') {
      const caption = commandArgument(body, 'caption')
      const main = protect(kind, body)
      return caption ? `${main}\n\n${protect('caption', latexToPlain(caption))}` : main
    }
    return protect(kind, body)
  })
  content = content.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_whole, bracketed, dollars) => protect('equation', bracketed ?? dollars ?? ''))
  content = content.replace(/\\(section|subsection|subsubsection|paragraph)\*?\s*\{([^}]*)\}/g, (_whole, _level, title: string) => protect('heading', latexToPlain(title)))

  const blocks: LatexBlock[] = []
  let currentSection: string | undefined
  for (const raw of content.split(/(?:\r?\n\s*){2,}/)) {
    const token = raw.trim().match(/^@@(latex-\d+)@@$/)?.[1]
    if (token) {
      const block = protectedBlocks.find((candidate) => candidate.id === token)
      if (!block) continue
      if (block.kind === 'heading') currentSection = block.source
      blocks.push({ ...block, section: block.kind === 'heading' ? block.source : currentSection })
      continue
    }
    const source = latexToPlain(raw)
    if (source.length < 2) continue
    blocks.push({ id: `latex-${protectedBlocks.length + blocks.length + 1}`, kind: 'paragraph', source, section: currentSection })
  }
  if (!blocks.some((block) => block.kind === 'paragraph')) return null
  return { version: 2, rootFile: path.relative(sourceDir, root.file).replace(/\\/g, '/'), generatedAt: new Date().toISOString(), blocks }
}
