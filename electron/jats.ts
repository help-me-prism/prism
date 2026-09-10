import { DOMParser } from '@xmldom/xmldom'
import type { LatexBlock, LatexStructure } from './latex.js'

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const directChild = (node: Node, name: string) => [...Array.from(node.childNodes)].find((child) => child.nodeType === 1 && child.nodeName.toLowerCase().split(':').at(-1) === name)
const descendants = (node: Node, name: string) => Array.from((node as Element).getElementsByTagName(name))

/** Convert semantic JATS content to the same bounded structure used to align LaTeX with PDF geometry. */
export function parseJatsStructure(xml: string, options: { provider?: 'europe-pmc'; license?: string } = {}): LatexStructure | null {
  if (!xml || xml.length > 30 * 1024 * 1024) return null
  const safeXml = xml.replace(/<!DOCTYPE[\s\S]*?\]>/i, '').replace(/<!DOCTYPE[^>]*>/i, '')
  const document = new DOMParser().parseFromString(safeXml, 'application/xml')
  if (!document.documentElement || document.getElementsByTagName('parsererror').length) return null
  const blocks: LatexBlock[] = []
  let currentSection: string | undefined
  const add = (kind: LatexBlock['kind'], source: string, section = currentSection) => {
    const value = clean(source)
    if (value.length < 2 || blocks.length >= 20_000) return
    blocks.push({ id: `jats-${blocks.length + 1}`, kind, source: value.slice(0, 100_000), section })
  }
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue
      const name = child.nodeName.toLowerCase().split(':').at(-1)
      if (name === 'sec') {
        const previous = currentSection
        const title = clean(directChild(child, 'title')?.textContent ?? '')
        if (title) { currentSection = title; add('heading', title, title) }
        walk(child)
        currentSection = previous
      } else if (name === 'title') {
        // Section, caption and article titles are emitted by their owning element.
      } else if (name === 'p') add('paragraph', child.textContent ?? '')
      else if (name === 'disp-formula') {
        const tex = descendants(child, 'tex-math')[0]?.textContent
        add('equation', tex || child.textContent || '')
      } else if (name === 'fig' || name === 'table-wrap') {
        const caption = descendants(child, 'caption')[0]
        if (caption) add('caption', caption.textContent ?? '')
      } else if (!['ref-list', 'ack', 'notes', 'fn-group'].includes(name ?? '')) walk(child)
    }
  }
  const abstract = document.getElementsByTagName('abstract')[0]
  if (abstract) {
    currentSection = 'Abstract'; add('heading', 'Abstract', 'Abstract'); walk(abstract)
  }
  const body = document.getElementsByTagName('body')[0]
  if (body) { currentSection = undefined; walk(body) }
  if (!blocks.some((block) => block.kind === 'paragraph')) return null
  return { version: 6, rootFile: 'source.jats.xml', generatedAt: new Date().toISOString(), format: 'jats', provider: options.provider, license: options.license, blocks }
}
