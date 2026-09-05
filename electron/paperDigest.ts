import { promises as fs } from 'node:fs'
import path from 'node:path'
import { listKnowledgeBacklinks, listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode } from './knowledge.js'
import { listKnowledgeRelations } from './relations.js'

/**
 * Notes only get written if writing them is nearly free. Prism already knows the paper and every chat the
 * researcher had about it, so it drafts the parts that are mechanical — a summary, what they kept asking,
 * what they kept pointing at — and leaves the one section that is actually theirs alone.
 *
 * Generated text lives between `<!-- prism:auto ... -->` markers and is replaced wholesale on every run.
 * Nothing outside those markers is ever touched.
 */
export type DigestChatMessage = { role: 'user' | 'assistant'; text: string; createdAt: number; paperIds?: string[]; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number; source?: string }> }
export type PaperDigestSection = 'overview' | 'confusion' | 'focus' | 'sources' | 'support' | 'against' | 'answers'
export type PaperDigestResult = { updated: boolean; chatMessages: number; sections: PaperDigestSection[]; usedModel: boolean }
export type RunPrompt = (prompt: string) => Promise<string>

const sectionHeadings: Record<PaperDigestSection, string> = { overview: '한눈에', confusion: '내가 헷갈린 것', focus: '내가 주목한 것', sources: '어디서 나왔나', support: '지지 근거', against: '반박', answers: '지금까지 나온 답' }
const userHeading = '내 생각'
const memoHeading = '메모'
const questionWords = /(왜|어떻게|무엇|뭐|뭔|어디|언제|어느|차이|이유|의미|맞나|맞아|인가|인지|할까|일까|되나|되는지|모르겠|이해가|헷갈|why|how|what|which|difference|mean)/i

function normalizeSpace(value: string) { return value.replace(/\s+/g, ' ').trim() }
function sentenceSplit(value: string) { return value.split(/(?<=[.!?。])\s+|\n+/).map(normalizeSpace).filter(Boolean) }

/** Chat is attributed to a paper by the context the composer recorded, or by any anchor the message carries. */
export function messagesForPaper(messages: DigestChatMessage[], arxivId: string) {
  return messages.filter((message) => message.paperIds?.includes(arxivId) || message.anchors?.some((anchor) => anchor.paperId === arxivId))
}

/** What the researcher kept pointing at: anchors referenced most often across their questions. */
export function focusFromChat(messages: DigestChatMessage[], arxivId: string) {
  const counts = new Map<string, { label: string; page?: number; source?: string; count: number }>()
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const anchor of message.anchors ?? []) {
      if (anchor.paperId !== arxivId) continue
      const previous = counts.get(anchor.anchorId)
      counts.set(anchor.anchorId, { label: anchor.label, page: anchor.page, source: anchor.source ?? previous?.source, count: (previous?.count ?? 0) + 1 })
    }
  }
  return [...counts.values()]
    .map((item) => ({ ...item, source: readableQuote(item.source) }))
    .sort((left, right) => right.count - left.count).slice(0, 5)
}

/**
 * Korean endings change while the subject stays the same ("왜 필요한가요" / "왜 필요한지"), so questions are
 * compared by content stems rather than by string equality. Two questions count as the same worry when they
 * share at least two stems and most of the shorter one.
 */
function questionStems(text: string) {
  return [...new Set(text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2)
    .map((token) => token.match(/^[a-z0-9]+/)?.[0] ?? token.slice(0, 3))
    .filter((token) => token.length >= 2 && !emptyRoots.some((root) => token.startsWith(root) || root.startsWith(token))))]
}
function sameWorry(left: string[], right: string[]) {
  const shared = left.filter((token) => right.includes(token)).length
  if (shared < 2) return false
  return shared / Math.min(left.length, right.length) >= 0.4
}
/**
 * What they kept getting stuck on. Splitting a message into sentences also produces trailing fragments
 * ("아직 이해가 안 됩니다"), which read as noise in a note, so a sentence only counts as a worry when it
 * names something the paper actually talks about — or when they came back to it more than once.
 */
export function confusionFromChat(messages: DigestChatMessage[], topics: Set<string> = new Set()) {
  const questions: Array<{ text: string; count: number; at: number; stems: string[] }> = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    for (const sentence of sentenceSplit(message.text)) {
      if (sentence.length < 6 || sentence.length > 200) continue
      if (!sentence.includes('?') && !questionWords.test(sentence)) continue
      const stems = questionStems(sentence)
      if (!stems.length) continue
      const existing = questions.find((item) => sameWorry(item.stems, stems))
      if (existing) {
        existing.count += 1; existing.at = Math.max(existing.at, message.createdAt)
        // Keep the shortest phrasing: it reads as the question rather than as a transcript.
        // Prefer the phrasing that names the subject; among equals, the shorter one reads as the question.
        const better = namesSomething(sentence) !== namesSomething(existing.text) ? namesSomething(sentence) : sentence.length < existing.text.length
        if (better) { existing.text = sentence; existing.stems = stems }
      } else questions.push({ text: sentence, count: 1, at: message.createdAt, stems })
    }
  }
  return questions
    .filter((item) => item.count > 1 || namesSomething(item.text) || item.stems.some((stem) => topics.has(stem)))
    .sort((left, right) => right.count - left.count || right.at - left.at)
    .slice(0, 5)
    .map(({ text: value, count, at }) => ({ text: value, count, at }))
}

/**
 * Sentence splitting also produces the tail of a thought — "아직 이해가 안 됩니다" — which reads as noise in a
 * note. A question is kept only when it names something: an ASCII term, or a Korean word that is not a bare
 * predicate and not one of the fillers below.
 */
const emptyRoots = ['아직', '이해', '생각', '정말', '진짜', '그냥', '조금', '다시', '근데', '그럼', '혹시', '무슨', '무엇', '어떤', '이런', '저런', '여기', '거기', '이거', '그거', '이게', '그게', '저게', '이것', '그것', '부분', '내용', '설명', '질문', '뭔지', '뭐가', 'still', 'really', 'think', 'understand', 'mean', 'sure', 'this', 'that', 'what', 'why', 'how']
const predicateEnding = /(다|요|까|죠|네|음|슴|지)$/
const particle = /(은|는|이|가|을|를|의|에|와|과|도|로|으로|에서|에게|보다|처럼|만|랑)$/

/** True when the sentence names a subject, rather than only commenting on one. */
export function namesSomething(sentence: string) {
  for (const token of sentence.split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue
    const ascii = /^[A-Za-z][A-Za-z0-9-]+$/.test(token)
    const base = ascii ? token.toLocaleLowerCase() : token.replace(particle, '')
    if (base.length < 2) continue
    if (emptyRoots.some((root) => base.startsWith(root) || root.startsWith(base))) continue
    if (!ascii && predicateEnding.test(token)) continue
    return true
  }
  return false
}

/** The words the paper itself uses, so a question can be checked against its subject matter. */
export function topicsOf(...sources: string[]) {
  return new Set(sources.flatMap((source) => questionStems(source)))
}

/**
 * PDF text layers hand back reference lists and half-parsed formulas as readily as prose. Quoting
 * "(2020); Song et al. (2020b)." next to an equation label teaches nothing, so such text is dropped and the
 * label stands on its own.
 */
function readableQuote(value?: string) {
  const quote = normalizeSpace(value ?? '')
  if (quote.length < 30) return undefined
  const letters = quote.replace(/[^\p{L}]/gu, '').length
  if (letters / quote.length < 0.62) return undefined
  if (/^[([]?\d{4}[)\]]?[;,]/.test(quote)) return undefined
  if (/et al\.\s*\(\d{4}[a-z]?\)[;,.]?\s*$/.test(quote) && quote.length < 90) return undefined
  const words = quote.split(' ')
  if (words.length < 6) return undefined
  return quote.length > 150 ? `${quote.slice(0, 150).trimEnd()}…` : quote
}

function abstractOf(content: string) {
  const match = content.match(/>\s*\[!abstract\][^\n]*\n((?:>[^\n]*\n?)*)/)
  if (!match) return ''
  return normalizeSpace(match[1].replace(/^>\s?/gm, ''))
}

function markers(section: PaperDigestSection) {
  return { open: `<!-- prism:auto ${section} -->`, close: `<!-- /prism:auto ${section} -->` }
}

/**
 * Replaces one generated region. When the note has no such region yet the section is inserted before the
 * researcher's own sections, so their writing always stays at the bottom where they left it.
 */
export function writeAutoSection(content: string, section: PaperDigestSection, body: string) {
  const { open, close } = markers(section)
  const block = `${open}\n${body.trim() || '_아직 없음_'}\n${close}`
  const normalized = content.replace(/\r\n/g, '\n')
  const start = normalized.indexOf(open)
  if (start >= 0) {
    const end = normalized.indexOf(close, start)
    if (end >= 0) return `${normalized.slice(0, start)}${block}${normalized.slice(end + close.length)}`
  }
  const heading = `## ${sectionHeadings[section]}`
  const headingAt = normalized.indexOf(`\n${heading}`)
  if (headingAt >= 0) {
    const afterHeading = normalized.indexOf('\n', headingAt + 1) + 1
    const nextHeading = normalized.slice(afterHeading).search(/\n#{1,2}\s/)
    const until = nextHeading < 0 ? normalized.length : afterHeading + nextHeading
    return `${normalized.slice(0, afterHeading)}\n${block}\n${normalized.slice(until)}`
  }
  const insertion = `\n\n${heading}\n\n${block}\n`
  // A summary is only useful at the top. Sections stack under each other, below the abstract, above everything else.
  const lastClose = [...normalized.matchAll(/<!-- \/prism:auto [a-z]+ -->/g)].at(-1)
  if (lastClose?.index !== undefined) {
    const at = lastClose.index + lastClose[0].length
    return `${normalized.slice(0, at)}${insertion}${normalized.slice(at)}`
  }
  const abstract = normalized.match(/>\s*\[!abstract\][^\n]*\n(?:>[^\n]*\n?)*/)
  if (abstract?.index !== undefined) {
    const at = abstract.index + abstract[0].length
    return `${normalized.slice(0, at)}${insertion}${normalized.slice(at)}`
  }
  const title = normalized.match(/^#\s[^\n]*\n/m)
  if (title?.index !== undefined) {
    const at = title.index + title[0].length
    return `${normalized.slice(0, at)}${insertion}${normalized.slice(at)}`
  }
  const anchorHeading = [`\n## ${userHeading}`, `\n## ${memoHeading}`].map((item) => normalized.indexOf(item)).filter((index) => index >= 0).sort((left, right) => left - right)[0]
  if (anchorHeading !== undefined) return `${normalized.slice(0, anchorHeading)}${insertion}${normalized.slice(anchorHeading)}`
  return `${normalized.trimEnd()}\n${insertion}`
}

// "The dominant sequence transduction models are based on…" is a paper naming what it means to replace,
// which is the problem — but it also says "based on", so the method cue has to be the narrower of the two:
// a sentence where the authors say what *they* did.
const overviewCues: Array<[string, RegExp]> = [
  ['문제', /\b(problem|challenge|difficult|limitation|however|but|expensive|unstable|cannot|lack)\b|\b(dominant|existing|current|prior|previous|traditional|conventional|standard)\b[^.]*\b(models?|methods?|approaches?|systems?)\b/i],
  ['방법', /\b(we (introduce|present|propose|develop|describe)|in this (paper|work)|our (method|approach|model))\b/i],
  ['결과', /\b(result|outperform|improv|achiev|better|faster|state[- ]of[- ]the[- ]art|show that|demonstrat)\b/i],
]

/**
 * Reading the abstract again is not a summary. One sentence each for the problem, the method and the
 * result gives the note something the abstract does not: a shape. Korean is used wherever the paper has
 * already been translated, because that is the language the researcher writes their own lines in.
 */
export function overviewFromAbstract(abstract: string, translations: TranslationLookup) {
  const sentences = sentenceSplit(abstract).filter((item) => item.length >= 20)
  if (!sentences.length) return []
  const used = new Set<number>()
  const lines: string[] = []
  for (const [label, cue] of overviewCues) {
    const index = sentences.findIndex((sentence, at) => !used.has(at) && cue.test(sentence))
    if (index < 0) continue
    used.add(index)
    lines.push(`**${label}** ${shorten(translations.find(sentences[index]) ?? sentences[index])}`)
  }
  if (lines.length) return lines
  return sentences.slice(0, 2).map((sentence) => shorten(translations.find(sentence) ?? sentence))
}
function shorten(value: string) { const text = normalizeSpace(value); return text.length > 170 ? `${text.slice(0, 170).trimEnd()}…` : text }
function quoteKey(value: string) { return normalizeSpace(value).replace(/\s+/g, '').toLocaleLowerCase() }

export type TranslationLookup = { find: (sentence: string) => string | undefined }

/**
 * The abstract in the note comes from arXiv's metadata while the translated sentences come from the paper's
 * own text, so the same sentence reaches us twice in slightly different words — "in an encoder-decoder
 * configuration" against "that include an encoder and a decoder". Keyed lookup misses, and one bullet of a
 * Korean summary is left standing in English. Two long sentences that open the same way are the same
 * sentence.
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

/** The Korean the reader already paid for: translated sentences, looked up by their source text. */
export async function readTranslations(libraryPath: string, arxivId: string): Promise<TranslationLookup> {
  const exact = new Map<string, string>()
  const entries: Array<readonly [string, string]> = []
  try {
    const raw = await fs.readFile(path.join(libraryPath, 'papers', arxivId, 'translation.ko.json'), 'utf8')
    for (const segment of (JSON.parse(raw) as { segments?: Array<{ source?: string; translation?: string }> }).segments ?? []) {
      if (!segment.source || !segment.translation) continue
      const key = quoteKey(segment.source)
      exact.set(key, segment.translation)
      entries.push([key, segment.translation] as const)
    }
  } catch { /* a paper that was never translated simply keeps its own language */ }
  return { find: (sentence) => { const key = quoteKey(sentence); return exact.get(key) ?? looseMatch(entries, key) } }
}

function bulletList(lines: string[]) { return lines.map((line) => `- ${line}`).join('\n') }

/** True when the note already shows real generated text for a section, as opposed to a placeholder or nothing. */
export function hasGeneratedContent(content: string, section: PaperDigestSection) {
  const { open, close } = markers(section)
  const start = content.indexOf(open)
  if (start < 0) return false
  const end = content.indexOf(close, start)
  if (end < 0) return false
  const body = content.slice(start + open.length, end).trim()
  return body.length > 0 && !/^_[^_]*_$/.test(body)
}

function buildPrompt(title: string, abstract: string, questions: string[], anchors: string[]) {
  return [
    'You are drafting the mechanical parts of a researcher\'s paper note in Korean. Be terse and factual.',
    'Never invent findings. Never write the researcher\'s opinion.',
    '',
    `TITLE: ${title}`,
    `ABSTRACT: ${abstract || '(none)'}`,
    '',
    'THEIR QUESTIONS ABOUT THIS PAPER (verbatim, may be empty):',
    ...(questions.length ? questions.map((item) => `- ${item}`) : ['- none']),
    '',
    'WHAT THEY POINTED AT (may be empty):',
    ...(anchors.length ? anchors.map((item) => `- ${item}`) : ['- none']),
    '',
    'Return ONLY JSON: {"overview":["3 short Korean bullets: problem, method, result"],"confusion":["at most 3 Korean bullets naming what THEY were unsure about, each grounded in their questions"]}',
    'If they asked nothing, return an empty confusion array. Do not restate the abstract in confusion.',
  ].join('\n')
}

function parseModelJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{'); const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('모델 응답에서 JSON을 찾지 못했습니다.')
  const value = JSON.parse(body.slice(start, end + 1)) as { overview?: unknown; confusion?: unknown }
  const list = (input: unknown) => Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(normalizeSpace).slice(0, 5) : []
  return { overview: list(value.overview), confusion: list(value.confusion) }
}

export async function refreshPaperDigest(libraryPath: string, paperNodeId: string, messages: DigestChatMessage[], runPrompt?: RunPrompt): Promise<PaperDigestResult> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const paper = nodes.find((node) => node.id === paperNodeId && node.nodeType === 'paper')
  if (!paper?.arxivId) throw new Error('논문 노트를 찾을 수 없습니다.')
  const snapshot = await readKnowledgeNode(libraryPath, paper.id)
  const abstract = abstractOf(snapshot.content)
  const paperMessages = messagesForPaper(messages, paper.arxivId)
  const focus = focusFromChat(paperMessages, paper.arxivId)
  const topics = topicsOf(paper.title, abstract, ...focus.map((item) => `${item.label} ${item.source ?? ''}`))
  const confusion = confusionFromChat(paperMessages, topics)
  const translations = await readTranslations(libraryPath, paper.arxivId)

  let overviewLines = overviewFromAbstract(abstract, translations)
  let confusionLines = confusion.map((item) => `${item.text}${item.count > 1 ? ` (${item.count}번 물어봄)` : ''}`)
  let usedModel = false
  if (runPrompt && (abstract || confusion.length)) {
    try {
      const parsed = parseModelJson(await runPrompt(buildPrompt(paper.title, abstract, confusion.map((item) => item.text), focus.map((item) => `${item.label}${item.page ? ` p.${item.page}` : ''}: ${normalizeSpace(item.source ?? '').slice(0, 160)}`))))
      if (parsed.overview.length) { overviewLines = parsed.overview; usedModel = true }
      if (parsed.confusion.length) { confusionLines = parsed.confusion; usedModel = true }
    } catch { /* the deterministic digest is still worth writing */ }
  }

  const focusLines = focus.map((item) => {
    const quote = item.source ? translations.find(item.source) ?? item.source : ''
    return `${item.label}${item.page ? ` (p.${item.page})` : ''}${item.count > 1 ? ` · ${item.count}번 참조` : ''}${quote ? ` — ${normalizeSpace(quote).slice(0, 120)}` : ''}`
  })

  let next = snapshot.content
  const written: PaperDigestSection[] = []
  const sections: Array<[PaperDigestSection, string[], string]> = [
    ['overview', overviewLines, '_초록이 없어 요약을 만들지 못했습니다._'],
    ['confusion', confusionLines, '_이 논문에 대해 물어본 것이 아직 없습니다._'],
    ['focus', focusLines, '_리더에서 문장을 태그하면 여기에 쌓입니다._'],
  ]
  for (const [section, lines, placeholder] of sections) {
    // Never trade written content for a placeholder: chat may be momentarily unreadable, and a note that
    // loses what it showed a minute ago is worse than one that is slightly stale.
    if (!lines.length && hasGeneratedContent(next, section)) continue
    const updated = writeAutoSection(next, section, lines.length ? bulletList(lines) : placeholder)
    if (updated !== next) { next = updated; written.push(section) }
  }
  if (next === snapshot.content) return { updated: false, chatMessages: paperMessages.length, sections: [], usedModel }
  const saved = await saveKnowledgeNode(libraryPath, paper.id, { content: next, expectedRevision: snapshot.revision })
  if (!saved.saved) throw new Error('노트가 외부에서 변경되어 자동 정리를 저장하지 못했습니다.')
  return { updated: true, chatMessages: paperMessages.length, sections: written, usedModel }
}

/** Chat lives in Electron's userData, outside the vault; the digest reads it without the renderer passing it along. */
export async function readChatMessages(sessionsPath: string): Promise<DigestChatMessage[]> {
  try {
    const value = JSON.parse(await fs.readFile(sessionsPath, 'utf8')) as Array<{ deletedAt?: number; messages?: DigestChatMessage[] }>
    if (!Array.isArray(value)) return []
    return value.filter((session) => !session.deletedAt).flatMap((session) => Array.isArray(session.messages) ? session.messages : [])
  } catch { return [] }
}

/**
 * Old templates left a page of empty headings that read as homework. This removes only headings with nothing
 * under them, never a section the researcher wrote in, and never a generated region.
 */
export async function pruneEmptySections(libraryPath: string, nodeId: string) {
  const snapshot = await readKnowledgeNode(libraryPath, nodeId)
  const lines = snapshot.content.replace(/\r\n/g, '\n').split('\n')
  const keep = new Array<boolean>(lines.length).fill(true)
  const removed: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#{2,6})\s+(.+?)\s*$/)
    if (!heading) continue
    let end = index + 1
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end += 1
    const body = lines.slice(index + 1, end).join('\n').trim()
    if (body) continue
    removed.push(heading[2])
    for (let cursor = index; cursor < end; cursor += 1) keep[cursor] = false
  }
  if (!removed.length) return { removed, snapshot }
  const next = lines.filter((_line, index) => keep[index]).join('\n').replace(/\n{3,}/g, '\n\n')
  const saved = await saveKnowledgeNode(libraryPath, nodeId, { content: `${next.trimEnd()}\n`, expectedRevision: snapshot.revision })
  if (!saved.saved) throw new Error('노트가 외부에서 변경되어 정리하지 못했습니다.')
  return { removed, snapshot: saved.snapshot }
}

export function digestSectionPath(libraryPath: string, paperNodeId: string) {
  return path.join(libraryPath, '.prism', 'cache', `${paperNodeId.replace(/[^a-zA-Z0-9._-]/g, '_')}.digest.json`)
}

const relationSections: Partial<Record<string, Array<{ section: PaperDigestSection; types: string[]; direction?: 'incoming' | 'outgoing' }>>> = {
  claim: [
    { section: 'support', types: ['supports', 'evidence_for'] },
    { section: 'against', types: ['contradicts'] },
  ],
  question: [
    { section: 'answers', types: ['answers'] },
  ],
  // A concept needs no relation list of its own: the sources section already names every note that reaches it.
}

const relationWording: Record<string, string> = { defines: '정의함', uses: '사용함', supports: '지지함', contradicts: '반박함', extends: '확장함', raises: '제기함', answers: '답함', explains: '설명함', evidence_for: '근거', mentions: '언급함' }

function relationLine(relation: { type: string; direction: string; other: { title: string; relativePath: string } }) {
  const wording = relationWording[relation.type] ?? relation.type
  const subject = `[[${relation.other.relativePath.replace(/\.md$/i, '')}|${relation.other.title}]]`
  return relation.direction === 'incoming' ? `${subject}가 ${wording}` : `${wording} · ${subject}`
}

/**
 * Concepts, Claims and Questions have no abstract and no chat of their own, but they are never alone in the
 * vault: something links to them, and something stands for or against them. That is what the note can say
 * without anybody typing, so that is what gets written.
 */
export async function refreshNoteDigest(libraryPath: string, nodeId: string, messages: DigestChatMessage[], runPrompt?: RunPrompt): Promise<PaperDigestResult> {
  const nodes = await listKnowledgeNodes(libraryPath)
  const node = nodes.find((item) => item.id === nodeId)
  if (!node) throw new Error('노트를 찾을 수 없습니다.')
  if (node.nodeType === 'paper') return refreshPaperDigest(libraryPath, nodeId, messages, runPrompt)

  const snapshot = await readKnowledgeNode(libraryPath, node.id)
  const [backlinks, relations] = await Promise.all([
    listKnowledgeBacklinks(libraryPath, node.id).catch(() => []),
    listKnowledgeRelations(libraryPath, node.id).catch(() => []),
  ])
  const approved = relations.filter((item) => item.reviewStatus === 'approved')
  const written: PaperDigestSection[] = []
  let next = snapshot.content

  const sourceLines = backlinks.map((item) => {
    // The line around a link is only worth quoting when it is a sentence, not a generated relation block.
    const excerpt = normalizeSpace(item.excerpt ?? '')
    const prose = excerpt.startsWith('>') || excerpt.startsWith('|') || excerpt.length < 12 || excerpt === item.title ? '' : sourceSentence(excerpt, node.title)
    return `[[${item.relativePath.replace(/\.md$/i, '')}|${item.title}]]${prose ? ` — ${prose}` : ''}`
  })
  const plan: Array<[PaperDigestSection, string[]]> = [['sources', sourceLines]]
  for (const rule of relationSections[node.nodeType] ?? []) {
    const lines = approved
      .filter((item) => rule.types.includes(item.type) && (!rule.direction || item.direction === rule.direction))
      .map(relationLine)
    plan.push([rule.section, lines])
  }

  for (const [section, lines] of plan) {
    // A section with nothing in it is the empty heading this whole design is trying to get rid of.
    if (!lines.length) { const removed = removeAutoSection(next, section); if (removed !== next) { next = removed; written.push(section) } ; continue }
    const updated = writeAutoSection(next, section, bulletList([...new Set(lines)]))
    if (updated !== next) { next = updated; written.push(section) }
  }

  if (next === snapshot.content) return { updated: false, chatMessages: 0, sections: [], usedModel: false }
  const saved = await saveKnowledgeNode(libraryPath, node.id, { content: next, expectedRevision: snapshot.revision })
  if (!saved.saved) throw new Error('노트가 외부에서 변경되어 자동 정리를 저장하지 못했습니다.')
  return { updated: true, chatMessages: 0, sections: written, usedModel: false }
}

/**
 * A backlink's excerpt is the whole line the link sits on, and in a paragraph that is several sentences —
 * quoted whole it ran off the end mid-word ("OT는 Optim"). The sentence that names this note is the one
 * worth keeping, and it ends where the sentence ends.
 */
function sourceSentence(excerpt: string, title: string) {
  const sentences = sentenceSplit(excerpt)
  const named = sentences.find((sentence) => sentence.includes(title)) ?? sentences[0] ?? ''
  if (named.length <= 140) return named
  const cut = named.slice(0, 140)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > 100 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

/** Takes a generated region and its heading away again once there is nothing to put in it. */
export function removeAutoSection(content: string, section: PaperDigestSection) {
  const { open, close } = markers(section)
  const normalized = content.replace(/\r\n/g, '\n')
  const start = normalized.indexOf(open)
  if (start < 0) return normalized
  const end = normalized.indexOf(close, start)
  if (end < 0) return normalized
  const heading = `## ${sectionHeadings[section]}`
  const headingAt = normalized.lastIndexOf(heading, start)
  const from = headingAt >= 0 && !normalized.slice(headingAt + heading.length, start).trim() ? headingAt : start
  return `${normalized.slice(0, from).trimEnd()}\n\n${normalized.slice(end + close.length).replace(/^\n+/, '')}`
}
