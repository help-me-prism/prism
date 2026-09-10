import { promises as fs } from 'node:fs'
import path from 'node:path'

export type LatexBlock = {
  id: string
  kind: 'heading' | 'paragraph' | 'caption' | 'equation' | 'figure' | 'table' | 'theorem'
  source: string
  section?: string
}

export type LatexStructure = {
  version: 6
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
  const inlineMath: string[] = []
  let marker = 'PRISM_INLINE_MATH'
  while (value.includes(marker)) marker += '_'
  const protectedValue = value.replace(/\\\(([\s\S]*?)\\\)|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_whole, parentheses: string | undefined, dollars: string | undefined) => {
    const index = inlineMath.push((parentheses ?? dollars ?? '').trim()) - 1
    return `${marker}${index}END`
  })
  let plain = protectedValue
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
  plain = plain.replace(new RegExp(`${marker}(\\d+)END`, 'g'), (_whole, index: string) => `$${inlineMath[Number(index)] ?? ''}$`)
  return plain
}

function environmentKind(name: string): LatexBlock['kind'] {
  if (/^(?:equation|align|gather|multline|displaymath|eqnarray)/.test(name)) return 'equation'
  if (/figure/.test(name)) return 'figure'
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
  const macros = latexMacros(content)
  const documentStart = content.search(/\\begin\s*\{document\}/)
  if (documentStart >= 0) content = content.slice(documentStart).replace(/^.*?\\begin\s*\{document\}/s, '')
  content = content.replace(/\\end\s*\{document\}[\s\S]*$/, '')
  content = expandLatexMacros(content, macros)
  content = content.replace(/\\begin\s*\{abstract\}([\s\S]*?)\\end\s*\{abstract\}/g, '\n\n\\section*{Abstract}\n\n$1\n\n')

  const protectedBlocks: LatexBlock[] = []
  const protect = (kind: LatexBlock['kind'], source: string) => {
    const id = `latex-${protectedBlocks.length + 1}`
    protectedBlocks.push({ id, kind, source: source.trim() })
    return `\n\n@@${id}@@\n\n`
  }
  content = content.replace(/\\begin\s*\{(algorithm\*?)\}([\s\S]*?)\\end\s*\{\1\}/g, (_whole, _name: string, body: string) => {
    const caption = commandArgument(body, 'caption')
    const main = protect('table', body)
    return caption ? `${main}\n\n${protect('caption', `Algorithm ${latexToPlain(caption)}`)}` : main
  })
  content = content.replace(/\\begin\s*\{restatable\}\s*\{(?:theorem|lemma|proposition|corollary|definition)\}\s*\{[^}]+\}([\s\S]*?)\\end\s*\{restatable\}/g, (_whole, body: string) => protect('theorem', latexToPlain(body)))
  content = content.replace(/\\begin\s*\{(theorem|lemma|proposition|corollary|definition)\*?\}([\s\S]*?)\\end\s*\{\1\*?\}/g, (_whole, _name: string, body: string) => protect('theorem', latexToPlain(body)))
  const environment = /\\begin\s*\{(equation\*?|align\*?|gather\*?|multline\*?|displaymath|eqnarray\*?|figure\*?|wrapfigure|table\*?|wraptable|tabular\*?|longtable)\}(?:\[[^\]]*\])?(?:\{[^{}]*\}){0,2}([\s\S]*?)\\end\s*\{\1\}/g
  content = content.replace(environment, (_whole, name: string, body: string) => {
    const kind = environmentKind(name)
    if (kind === 'figure' && /@@latex-\d+@@/.test(body)) return body
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
  return { version: 6, rootFile: path.relative(sourceDir, root.file).replace(/\\/g, '/'), generatedAt: new Date().toISOString(), blocks }
}

type LatexMacro = { arguments: number; body: string }

function braceGroup(value: string, from: number, open = '{', close = '}'): { body: string; end: number } | undefined {
  if (value[from] !== open) return undefined
  let depth = 0
  for (let index = from; index < value.length; index += 1) {
    if (value[index] === '\\') { index += 1; continue }
    if (value[index] === open) depth += 1
    else if (value[index] === close && --depth === 0) return { body: value.slice(from + 1, index), end: index + 1 }
  }
  return undefined
}

function latexMacros(value: string) {
  const macros = new Map<string, LatexMacro>()
  const remember = (name: string, argumentsCount: number, body: string) => {
    if (macros.size < 500 && argumentsCount <= 4 && body.length <= 2_000) macros.set(name, { arguments: argumentsCount, body })
  }
  for (const match of value.matchAll(/\\(?:re)?newcommand\s*\{\\([A-Za-z@]+)\}/g)) {
    let cursor = match.index! + match[0].length
    while (/\s/.test(value[cursor] ?? '')) cursor += 1
    let argumentsCount = 0
    if (value[cursor] === '[') {
      const count = braceGroup(value, cursor, '[', ']')
      if (!count || !/^\d+$/.test(count.body.trim())) continue
      argumentsCount = Number(count.body.trim()); cursor = count.end
      while (/\s/.test(value[cursor] ?? '')) cursor += 1
      if (value[cursor] === '[') continue
    }
    const body = braceGroup(value, cursor)
    if (body) remember(match[1], argumentsCount, body.body)
  }
  for (const match of value.matchAll(/\\(?:global\s*)?(?:def|gdef|edef|xdef)\s*\\([A-Za-z@]+)/g)) {
    const cursor = match.index! + match[0].length
    const bodyStart = value.indexOf('{', cursor)
    if (bodyStart < 0 || bodyStart - cursor > 40) continue
    const signature = value.slice(cursor, bodyStart)
    if (!/^(?:\s*#\d\s*)*$/.test(signature)) continue
    const body = braceGroup(value, bodyStart)
    const argumentNumbers = [...signature.matchAll(/#(\d)/g)].map(item => Number(item[1]))
    if (body) remember(match[1], argumentNumbers.length ? Math.max(...argumentNumbers) : 0, body.body)
  }
  return macros
}

/** Expand bounded document-local macros into portable LaTeX without executing TeX. */
function expandLatexMacros(value: string, macros: Map<string, LatexMacro>) {
  let expanded = value
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false; let result = ''
    for (let index = 0; index < expanded.length;) {
      if (expanded[index] !== '\\' || !/[A-Za-z@]/.test(expanded[index + 1] ?? '')) { result += expanded[index++]; continue }
      let end = index + 1
      while (/[A-Za-z@]/.test(expanded[end] ?? '')) end += 1
      const macro = macros.get(expanded.slice(index + 1, end))
      if (!macro) { result += expanded.slice(index, end); index = end; continue }
      let cursor = end; const args: string[] = []
      for (let argument = 0; argument < macro.arguments; argument += 1) {
        while (/\s/.test(expanded[cursor] ?? '')) cursor += 1
        const group = braceGroup(expanded, cursor)
        if (!group) break
        args.push(group.body); cursor = group.end
      }
      if (args.length !== macro.arguments) { result += expanded.slice(index, end); index = end; continue }
      let replacement = macro.body
      // Braces preserve TeX token boundaries: `\Vert#1` with argument `x`
      // must become `\Vert{x}`, not the unrelated command `\Vertx`.
      for (let argument = args.length; argument >= 1; argument -= 1) replacement = replacement.replaceAll(`#${argument}`, `{${args[argument - 1]}}`)
      if (result.length + replacement.length > 5_000_000) return expanded
      result += replacement; index = cursor; changed = true
    }
    expanded = result
    if (!changed) break
  }
  return expanded
}
