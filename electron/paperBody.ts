import { promises as fs } from 'node:fs'
import path from 'node:path'

/** Paper text from the current reader anchor registry, with matching paid translations reused. */
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

type Segment = { id?: string; source?: string; translation?: string; kind?: string; page?: number; sectionTitle?: string }

const bodies = new Map<string, { signature: string; body: PaperBody }>()

function normalizeSpace(value: string) { return value.replace(/\s+/g, ' ').trim() }
function quoteKey(value: string) { return normalizeSpace(value) }

/** A known publisher proof query occasionally shares one PDF text item with real prose. */
function withoutPublisherQuery(source: string) {
  return source.replace(/^\s*AU\s*:\s*Please\s*confirm\s*that\s*all\s*heading\s*levels\s*are\s*represented\s*correctly\s*:\s*/i, '')
}
function publisherPlaceholderHeading(source: string) {
  return /^(?:a1111111111\s*){4,}$/i.test(source.trim())
}

const emptyBody: PaperBody = { sections: [], find: () => undefined, outline: () => [], mentioning: () => [] }

function buildBody(segments: Segment[]): PaperBody {
  const exact = new Map<string, string>()
  const sections: PaperSection[] = []
  const prose: Array<{ title: string; text: string }> = []
  let heading = '본문'
  for (const segment of segments) {
    const source = withoutPublisherQuery(segment.source || '')
    const translation = source === segment.source ? segment.translation : undefined
    if (segment.kind === 'heading' && source.trim()) {
      heading = publisherPlaceholderHeading(source) ? '본문' : normalizeSpace(translation || source)
      continue
    }
    if (segment.source && translation) {
      const key = quoteKey(segment.source)
      exact.set(key, translation)
    }
    // Equations, captions and the page furniture the extractor calls artifacts are not the paper's argument.
    if (segment.kind !== 'text') continue
    const text = normalizeSpace(translation || source)
    // Running heads, page numbers and footnote markers all arrive as very short "text" segments.
    if (text.length < 25) continue
    const sectionTitle = withoutPublisherQuery(segment.sectionTitle || '')
    const title = (publisherPlaceholderHeading(sectionTitle) ? '' : normalizeSpace(sectionTitle)) || heading
    const last = sections.at(-1)
    if (last?.title === title) last.lines.push(text)
    else sections.push({ title, page: Number(segment.page) || 0, lines: [text] })
    prose.push({ title, text })
  }
  return {
    sections,
    find: (sentence) => { const key = quoteKey(sentence); return exact.get(key) },
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

const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }
type LoadedPayload = { signature: string; value?: unknown; missing?: boolean }
// Bound both entry count and serialized source bytes (parsed objects also carry overhead).
const payloads = new Map<string, { result: LoadedPayload; bytes: number }>()
let payloadBytes = 0
const payloadBudget = 64 * 1024 * 1024

async function load(file: string, boundary?: string): Promise<LoadedPayload> {
  try {
    const real = await fs.realpath(file)
    if (boundary && !inside(await fs.realpath(boundary), real)) return { signature: 'outside' }
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return { signature: 'invalid' }
    const signature = `${real}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    const cached = payloads.get(real)
    if (cached?.result.signature === signature) {
      payloads.delete(real); payloads.set(real, cached)
      return cached.result
    }
    if (cached) { payloadBytes -= cached.bytes; payloads.delete(real) }
    let result: LoadedPayload
    try { result = { signature, value: JSON.parse(await fs.readFile(real, 'utf8')) } } catch { return { signature } }
    while (payloads.size && (payloads.size >= 32 || payloadBytes + stat.size > payloadBudget)) {
      const oldest = payloads.keys().next().value!
      payloadBytes -= payloads.get(oldest)!.bytes; payloads.delete(oldest)
    }
    payloads.set(real, { result, bytes: stat.size }); payloadBytes += stat.size
    return result
  } catch (error) { return { signature: 'missing', missing: (error as NodeJS.ErrnoException).code === 'ENOENT' } }
}

function validSegments(value: unknown, anchor: boolean): Segment[] {
  if (!Array.isArray(value)) return []
  const counts = new Map<string, number>()
  for (const item of value) if (item && typeof item.id === 'string') counts.set(item.id, (counts.get(item.id) || 0) + 1)
  return value.filter(item => item && typeof item.source === 'string' && typeof item.id === 'string' && counts.get(item.id) === 1
    && Number.isInteger(item.page) && item.page > 0 && typeof (anchor ? item.type : item.kind) === 'string')
    .map(item => ({ id: item.id, source: item.source, kind: anchor ? item.type : item.kind, page: item.page,
      sectionTitle: typeof item.sectionTitle === 'string' ? item.sectionTitle : undefined,
      translation: !anchor && typeof item.translation === 'string' ? item.translation : undefined }))
}

export async function readPaperBody(libraryPath: string, arxivId: string): Promise<PaperBody> {
  if (!arxivId || arxivId === '.' || arxivId === '..' || arxivId.length > 300) return emptyBody
  const safeId = arxivId.replace(/[^a-zA-Z0-9._-]+/g, '_')
  const anchorId = arxivId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160)
  const index = await load(path.join(libraryPath, '.prism', 'library.json'), libraryPath)
  const records = Array.isArray(index.value) ? index.value.filter(item => item?.arxivId === arxivId) : []
  if (records.length > 1 || (!index.missing && !Array.isArray(index.value))) return emptyBody
  const record = records[0]
  const registeredPath = typeof record?.translationPath === 'string' && record.translationPath ? record.translationPath : undefined
  const external = record?.externalAssets === true
  // Same moved-vault rebasing policy as main: internal assets move beneath papers/<safeId>;
  // explicitly registered external assets retain their own location.
  const translationPath = registeredPath && (external || inside(libraryPath, path.resolve(registeredPath)))
    ? path.resolve(registeredPath) : path.join(libraryPath, 'papers', safeId, path.basename(registeredPath || 'translation.ko.json'))
  const [canonical, translated] = await Promise.all([
    load(path.join(libraryPath, '.prism', 'anchors', `${anchorId}.json`), libraryPath),
    load(translationPath, external ? undefined : libraryPath),
  ])
  const key = JSON.stringify([path.resolve(libraryPath), arxivId])
  const signature = `${index.signature}|${canonical.signature}|${translated.signature}`
  const cached = bodies.get(key)
  if (cached?.signature === signature) return cached.body
  const anchors = canonical.value as { paperId?: unknown; anchors?: unknown } | undefined
  const translation = translated.value as { paperId?: unknown; arxivId?: unknown; segments?: unknown } | undefined
  const translationIdentity = translation && (translation.paperId === undefined || translation.paperId === arxivId) && (translation.arxivId === undefined || translation.arxivId === arxivId)
  const translations = translationIdentity ? validSegments(translation.segments, false) : []
  let segments: Segment[] = []
  if (anchors?.paperId === arxivId && Array.isArray(anchors.anchors)) {
    const byId = new Map(translations.map(segment => [segment.id, segment]))
    segments = validSegments(anchors.anchors, true).map(segment => {
      const match = byId.get(segment.id)
      return match && match.source === segment.source ? { ...segment, translation: match.translation } : segment
    })
  } else if (canonical.missing) {
    // Older vaults have only a translation cache. Never let a corrupt/mismatched registry
    // silently resurrect an obsolete cache after current source became available.
    segments = translations
  }
  const body = buildBody(segments)
  if (bodies.size >= 64) bodies.delete(bodies.keys().next().value!)
  bodies.set(key, { signature, body })
  return body
}
