import { promises as fs } from 'node:fs'
import path from 'node:path'
import { listKnowledgeNodes, readKnowledgeNode, saveKnowledgeNode } from './knowledge.js'

/**
 * Notes only get written if writing them is nearly free. Prism already knows the paper and every chat the
 * researcher had about it, so it drafts the parts that are mechanical — a summary, what they kept asking,
 * what they kept pointing at — and leaves the one section that is actually theirs alone.
 *
 * Generated text lives between `<!-- prism:auto ... -->` markers and is replaced wholesale on every run.
 * Nothing outside those markers is ever touched.
 */
export type DigestChatMessage = { role: 'user' | 'assistant'; text: string; createdAt: number; paperIds?: string[]; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number; source?: string }> }
export type PaperDigestSection = 'overview' | 'confusion' | 'focus'
export type PaperDigestResult = { updated: boolean; chatMessages: number; sections: PaperDigestSection[]; usedModel: boolean }
export type RunPrompt = (prompt: string) => Promise<string>

const sectionHeadings: Record<PaperDigestSection, string> = { overview: '한눈에', confusion: '내가 헷갈린 것', focus: '내가 주목한 것' }
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
  return [...counts.values()].sort((left, right) => right.count - left.count).slice(0, 5)
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
    .filter((token) => token.length >= 2 && !/^(이거|그거|저거|무엇|뭔가|논문|이것|그것)$/.test(token)))]
}
function sameWorry(left: string[], right: string[]) {
  const shared = left.filter((token) => right.includes(token)).length
  if (shared < 2) return false
  return shared / Math.min(left.length, right.length) >= 0.4
}
/** What they kept getting stuck on: their own questions, with repeats surfaced first. */
export function confusionFromChat(messages: DigestChatMessage[]) {
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
        if (sentence.length < existing.text.length) { existing.text = sentence; existing.stems = stems }
      } else questions.push({ text: sentence, count: 1, at: message.createdAt, stems })
    }
  }
  return questions.sort((left, right) => right.count - left.count || right.at - left.at)
    .slice(0, 5)
    .map(({ text, count, at }) => ({ text, count, at }))
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
  const confusion = confusionFromChat(paperMessages)

  let overviewLines = abstract ? sentenceSplit(abstract).slice(0, 3) : []
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
    const quote = normalizeSpace(item.source ?? '').slice(0, 90)
    return `${item.label}${item.page ? ` (p.${item.page})` : ''}${item.count > 1 ? ` · ${item.count}번 참조` : ''}${quote ? ` — ${quote}` : ''}`
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
