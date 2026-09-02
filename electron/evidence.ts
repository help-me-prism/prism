import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { listKnowledgeNodes, readKnowledgeNode } from './knowledge.js'

export type EvidenceAnchorType = 'sentence' | 'equation' | 'table' | 'figure' | 'page'
export type EvidencePaper = { arxivId: string; title: string; pdfPath: string }
export type EvidenceAnchor = {
  paperId: string
  paperTitle: string
  anchorId: string
  type: EvidenceAnchorType
  page: number
  label: string
  source: string
  sourceHash: string
  availability: 'linked' | 'needs-relink'
}
export type EvidenceBacklink = { nodeId: string; title: string; nodeType: 'paper' | 'concept' | 'claim' | 'insight' | 'question' | 'project'; relativePath: string; excerpt: string }

type StoredAnchor = { id?: unknown; type?: unknown; page?: unknown; source?: unknown }
const sourceTypes = new Set(['text', 'heading', 'caption', 'equation', 'table', 'figure'])
const safePaperId = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

async function readJson(filePath: string) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown } catch { return undefined }
}

async function storedAnchors(libraryPath: string, paper: EvidencePaper): Promise<StoredAnchor[]> {
  const canonical = path.join(libraryPath, '.prism', 'anchors', `${safePaperId(paper.arxivId)}.json`)
  const legacy = path.join(path.dirname(paper.pdfPath), 'anchors.json')
  const payload = await readJson(canonical) ?? await readJson(legacy)
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { anchors?: unknown }).anchors)) return []
  return (payload as { anchors: StoredAnchor[] }).anchors
}

async function figureAnchors(paper: EvidencePaper): Promise<StoredAnchor[]> {
  const directory = path.join(path.dirname(paper.pdfPath), 'figures')
  let entries: string[]
  try { entries = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith('.json')) } catch { return [] }
  const figures: StoredAnchor[] = []
  for (const name of entries) {
    const data = await readJson(path.join(directory, name))
    if (!data || typeof data !== 'object') continue
    const item = data as { figureId?: unknown; page?: unknown; caption?: unknown; sourcePath?: unknown }
    figures.push({ id: item.figureId, type: 'figure', page: item.page, source: typeof item.caption === 'string' && item.caption.trim() ? item.caption : `Saved figure${typeof item.sourcePath === 'string' ? ` from ${item.sourcePath}` : ''}` })
  }
  return figures
}

export async function listEvidenceAnchors(libraryPath: string, papers: EvidencePaper[]): Promise<EvidenceAnchor[]> {
  const result: EvidenceAnchor[] = []
  for (const paper of papers) {
    const counters: Record<EvidenceAnchorType, number> = { sentence: 0, equation: 0, table: 0, figure: 0, page: 0 }
    const stored = [...await storedAnchors(libraryPath, paper), ...await figureAnchors(paper)]
    const maxPage = stored.reduce((maximum, item) => Number.isInteger(item.page) ? Math.max(maximum, Number(item.page)) : maximum, 0)
    for (const item of stored) {
      if (typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 300 || typeof item.type !== 'string' || !sourceTypes.has(item.type)
        || !Number.isInteger(item.page) || Number(item.page) < 1 || typeof item.source !== 'string') continue
      const type: EvidenceAnchorType = item.type === 'equation' || item.type === 'table' || item.type === 'figure' ? item.type : 'sentence'
      counters[type] += 1
      const source = item.source.slice(0, 20_000)
      result.push({ paperId: paper.arxivId, paperTitle: paper.title, anchorId: item.id, type, page: Number(item.page), label: `${type === 'sentence' ? '문장' : type === 'equation' ? '수식' : type === 'table' ? '표' : '피겨'}${counters[type]}`, source, sourceHash: digest(source), availability: 'linked' })
    }
    for (let page = 1; page <= maxPage; page += 1) result.push({ paperId: paper.arxivId, paperTitle: paper.title, anchorId: `p${page}`, type: 'page', page, label: `페이지${page}`, source: `Page ${page} of ${paper.title}`, sourceHash: digest(`Page ${page} of ${paper.title}`), availability: 'linked' })
  }
  return result.sort((left, right) => left.paperTitle.localeCompare(right.paperTitle) || left.page - right.page || left.label.localeCompare(right.label))
}

export async function listEvidenceBacklinks(libraryPath: string, paperId: string, anchorId: string): Promise<EvidenceBacklink[]> {
  const result: EvidenceBacklink[] = []
  for (const node of await listKnowledgeNodes(libraryPath)) {
    const snapshot = await readKnowledgeNode(libraryPath, node.id)
    let matchedSource = ''
    for (const match of snapshot.content.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)) {
      try {
        const value = JSON.parse(decodeURIComponent(match[1])) as { paperId?: unknown; anchorId?: unknown; source?: unknown }
        if (value.paperId === paperId && value.anchorId === anchorId) { matchedSource = typeof value.source === 'string' ? value.source : ''; break }
      } catch { /* ignore malformed derived metadata */ }
    }
    if (matchedSource || snapshot.content.includes(`prism://paper/${encodeURIComponent(paperId)}?anchor=${encodeURIComponent(anchorId)}`)) result.push({ nodeId: node.id, title: node.title, nodeType: node.nodeType, relativePath: node.relativePath, excerpt: matchedSource.slice(0, 240) })
  }
  return result
}
