import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * The paper itself, as the reader already has it.
 *
 * Prism translates every sentence of a paper the first time it is opened and then uses that file for one
 * thing: looking up a sentence to print it in Korean. The same file knows which section each sentence is in,
 * whether it is prose or an equation or a caption, and what page it is on — so a summary drafted from the
 * abstract alone was drafted from a fraction of what was already downloaded, and a concept definition was
 * built out of backlink excerpts while the paragraph that actually explains the term sat unread on disk.
 *
 * Parsing is cached by mtime and size because a sweep can ask for the same paper repeatedly and these files
 * run to hundreds of segments.
 */
export type PaperSection = { title: string; page: number; lines: string[] }
export type PaperBody = {
  sections: PaperSection[]
  /** The Korean the reader already paid for, looked up by the sentence it was translated from. */
  find: (sentence: string) => string | undefined
  /** Prose from the paper, in reading order, at most `perSection` lines from each section. */
  outline: (perSection: number, limit: number) => string[]
  /** Sentences anywhere in the paper that name something, for grounding a definition in the text that explains it. */
  mentioning: (names: (text: string) => boolean, limit: number) => string[]
}

type Segment = { source?: string; translation?: string; kind?: string; page?: number; sectionTitle?: string }

const bodies = new Map<string, { mtimeMs: number; size: number; body: PaperBody }>()

function normalizeSpace(value: string) { return value.replace(/\s+/g, ' ').trim() }
function quoteKey(value: string) { return normalizeSpace(value).replace(/\s+/g, '').toLocaleLowerCase() }

/**
 * The abstract in the note comes from arXiv's metadata while the translated sentences come from the paper's
 * own text, so the same sentence reaches us twice in slightly different words — "in an encoder-decoder
 * configuration" against "that include an encoder and a decoder". Keyed lookup misses, and one bullet of a
 * Korean summary is left standing in English. Two long sentences that open the same way are the same sentence.
 */
function looseMatch(entries: ReadonlyArray<readonly [string, string]>, key: string) {
  if (key.length < 40) return undefined
  let best: string | undefined
  let bestShared = 0
  for (const [candidate, translation] of entries) {
    if (candidate.length < 40) continue
    let shared = 0
    while (shared < key.length && shared < candidate.length && key[shared] === candidate[shared]) shared += 1
    if (shared <= bestShared || shared < 40 || shared / Math.min(key.length, candidate.length) < 0.6) continue
    bestShared = shared; best = translation
  }
  return best
}

const emptyBody: PaperBody = { sections: [], find: () => undefined, outline: () => [], mentioning: () => [] }

function buildBody(segments: Segment[]): PaperBody {
  const exact = new Map<string, string>()
  const entries: Array<readonly [string, string]> = []
  const sections: PaperSection[] = []
  const prose: Array<{ title: string; text: string }> = []
  for (const segment of segments) {
    if (segment.source && segment.translation) {
      const key = quoteKey(segment.source)
      exact.set(key, segment.translation)
      entries.push([key, segment.translation] as const)
    }
    // Equations, captions and the page furniture the extractor calls artifacts are not the paper's argument.
    if (segment.kind !== 'text') continue
    const text = normalizeSpace(segment.translation || segment.source || '')
    // Running heads, page numbers and footnote markers all arrive as very short "text" segments.
    if (text.length < 25) continue
    const title = normalizeSpace(segment.sectionTitle || '') || '본문'
    const last = sections.at(-1)
    if (last?.title === title) last.lines.push(text)
    else sections.push({ title, page: Number(segment.page) || 0, lines: [text] })
    prose.push({ title, text })
  }
  return {
    sections,
    find: (sentence) => { const key = quoteKey(sentence); return exact.get(key) ?? looseMatch(entries, key) },
    outline: (perSection, limit) => {
      const picked: string[] = []
      for (const section of sections) {
        for (const line of section.lines.slice(0, perSection)) {
          picked.push(`[${section.title}] ${line}`)
          if (picked.length >= limit) return picked
        }
      }
      return picked
    },
    mentioning: (names, limit) => {
      const found: string[] = []
      const seen = new Set<string>()
      for (const { title, text } of prose) {
        if (!names(text) || seen.has(text)) continue
        seen.add(text)
        found.push(`[${title}] ${text}`)
        if (found.length >= limit) break
      }
      return found
    },
  }
}

export async function readPaperBody(libraryPath: string, arxivId: string): Promise<PaperBody> {
  const filePath = path.join(libraryPath, 'papers', arxivId, 'translation.ko.json')
  const key = path.resolve(filePath).toLowerCase()
  try {
    const stat = await fs.stat(filePath)
    const cached = bodies.get(key)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.body
    const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as { segments?: Segment[] }
    const body = buildBody(Array.isArray(value.segments) ? value.segments : [])
    bodies.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, body })
    return body
  } catch {
    // A paper that was never opened or never translated simply keeps its own language and its abstract.
    bodies.delete(key)
    return emptyBody
  }
}
