import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'
import { listKnowledgeNodes } from './knowledge.js'

/**
 * Citation graph = the automatic layer. It is cached per paper, shown in its own panel, and never mixed into the
 * researcher's relations. The only bridge is an explicit "extends" relation the user creates from a citation row.
 */
export type CitationEntry = { arxivId?: string; title: string; year?: number; citationCount?: number; authors: string[]; inLibrary: boolean; nodeId?: string }
export type CitationLinks = { arxivId: string; fetchedAt: string; references: CitationEntry[]; citations: CitationEntry[]; stale: boolean; error?: string }
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
type RawEntry = { arxivId?: string; title: string; year?: number; citationCount?: number; authors: string[] }
type Stored = { version: 1; arxivId: string; fetchedAt: string; references: RawEntry[]; citations: RawEntry[] }

const maxAgeMs = 7 * 24 * 60 * 60 * 1000
const storePath = (libraryPath: string, arxivId: string) => path.join(libraryPath, '.prism', 'citations', `${arxivId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)

function parseEntries(payload: unknown, key: 'citedPaper' | 'citingPaper'): RawEntry[] {
  const data = (payload as { data?: unknown[] } | undefined)?.data
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const paper = (item as Record<string, unknown> | undefined)?.[key] as { title?: string; year?: number; citationCount?: number; externalIds?: { ArXiv?: string }; authors?: Array<{ name?: string }> } | undefined
    if (!paper?.title) return []
    return [{ arxivId: paper.externalIds?.ArXiv, title: paper.title, year: paper.year, citationCount: paper.citationCount, authors: (paper.authors ?? []).map((author) => author.name ?? '').filter(Boolean) }]
  })
}

export async function fetchCitationGraph(arxivId: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Omit<Stored, 'version'>> {
  const fields = 'title,year,citationCount,externalIds,authors'
  const headers = { 'User-Agent': 'Prism/0.1 local desktop research reader' }
  const base = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(arxivId)}`
  const [references, citations] = await Promise.all([
    fetchImpl(`${base}/references?fields=${encodeURIComponent(fields)}&limit=500`, { headers }),
    fetchImpl(`${base}/citations?fields=${encodeURIComponent(fields)}&limit=500`, { headers }),
  ])
  if (!references.ok && !citations.ok) throw new Error(`Semantic Scholar 응답 오류 (${references.status}).`)
  return { arxivId, fetchedAt: new Date().toISOString(), references: references.ok ? parseEntries(await references.json(), 'citedPaper') : [], citations: citations.ok ? parseEntries(await citations.json(), 'citingPaper') : [] }
}

/**
 * `refresh: false` reads the cache only (no network, even when stale); `refresh: true` forces a fetch;
 * omitted means fetch when the cache is missing or older than a week.
 */
export async function listPaperCitations(libraryPath: string, arxivId: string, options: { refresh?: boolean; fetchImpl?: FetchLike } = {}): Promise<CitationLinks> {
  let stored: Stored | undefined
  try { const value = JSON.parse(await fs.readFile(storePath(libraryPath, arxivId), 'utf8')) as Stored; if (value?.version === 1 && Array.isArray(value.references) && Array.isArray(value.citations)) stored = value } catch { /* no cache yet */ }
  const isStale = (entry?: Stored) => !entry || Number.isNaN(Date.parse(entry.fetchedAt)) || Date.now() - Date.parse(entry.fetchedAt) > maxAgeMs
  let error: string | undefined
  if (options.refresh === true || (options.refresh === undefined && isStale(stored))) {
    try {
      const fresh = await fetchCitationGraph(arxivId, options.fetchImpl)
      stored = { version: 1, ...fresh }
      await fs.mkdir(path.dirname(storePath(libraryPath, arxivId)), { recursive: true })
      await atomicWriteFile(storePath(libraryPath, arxivId), JSON.stringify(stored, null, 2))
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
  }
  if (!stored) return { arxivId, fetchedAt: '', references: [], citations: [], stale: true, error }
  const papers = new Map((await listKnowledgeNodes(libraryPath)).filter((node) => node.nodeType === 'paper' && node.arxivId).map((node) => [node.arxivId!, node.id]))
  const enrich = (entry: RawEntry): CitationEntry => ({ ...entry, inLibrary: Boolean(entry.arxivId && papers.has(entry.arxivId)), nodeId: entry.arxivId ? papers.get(entry.arxivId) : undefined })
  const order = (left: CitationEntry, right: CitationEntry) => Number(right.inLibrary) - Number(left.inLibrary) || (right.citationCount ?? 0) - (left.citationCount ?? 0) || left.title.localeCompare(right.title)
  return { arxivId: stored.arxivId, fetchedAt: stored.fetchedAt, references: stored.references.map(enrich).sort(order), citations: stored.citations.map(enrich).sort(order), stale: isStale(stored), error }
}
