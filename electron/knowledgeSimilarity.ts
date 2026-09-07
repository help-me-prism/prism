import { knowledgePlainText, readVaultSnapshot, type KnowledgeNodeRecord } from './knowledge.js'

/**
 * Which two notes are about the same thing without being linked.
 *
 * This is not the search index. Search hashes words *and* character 2/3-grams into 384 buckets, which is right
 * for finding a note from a half-remembered phrase — n-grams survive typos and endings, and a collision only
 * costs a slightly worse ranking next to an exact text score. Here the similarity is the whole signal, and both
 * of those choices are wrong: character n-grams make any two Korean notes look alike because they share
 * syllables, and 384 buckets for a vault's worth of features collide constantly. So this measures words only,
 * over exact sparse vectors, on the part of the note the researcher actually wrote.
 */

export type SimilarPair = { a: string; b: string; score: number; shared: string[] }
export type SimilarityReport = {
  pairs: SimilarPair[]
  /** How the threshold was arrived at, so a suggestion list can say why it is the length it is. */
  measured: number
  compared: number
  threshold: number
  median: number
  deviation: number
  /** Notes with too little of the researcher's own writing to compare. */
  thin: string[]
}

const autoRegion = /<!--\s*prism:auto\s+[a-z-]+\s*-->[\s\S]*?<!--\s*\/prism:auto\s+[a-z-]+\s*-->/g
const minimumTerms = 10
const topTermsPerNote = 40
const candidateTerms = 14

/**
 * Only what the researcher wrote. Generated sections are the same phrases in every note of a kind, and headings
 * come from the template rather than the thinking — counting either makes two notes look alike for having been
 * made from the same form.
 */
export function authoredText(content: string) {
  return knowledgePlainText(content.replace(autoRegion, ' ').replace(/^#{1,6}[^\n]*$/gm, ' '))
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}

// Longest first: `으로` has to be tried before `로`, or 스케줄으로 stems to 스케줄으.
const korean = ['되었다', '으로', '에서', '에게', '까지', '부터', '보다', '처럼', '하고', '이며', '이다', '한다', '하다', '했다', '된다', '되는', '하는', '지만', '를', '을', '은', '는', '이', '가', '의', '에', '도', '와', '과', '해', '로', '며']
const english = ['ing', 'ed', 'es', 's']

/** Words, with the ending taken off so 스케줄을 and 스케줄이 count as one thing. No character n-grams. */
export function words(value: string) {
  const result: string[] = []
  // A token can carry two scripts at once — `matching와`, `solver이` — and the ending has to come off the Latin
  // stem too, or the same word counts as a different one every time a different particle follows it.
  const raw = (normalized(value).match(/[\p{L}\p{N}]+/gu) ?? [])
    .flatMap((token) => token.split(/(?<=[a-z0-9])(?=[가-힣])|(?<=[가-힣])(?=[a-z0-9])/))
  for (const word of raw) {
    if (word.length < 2) continue
    if (/^\d+$/.test(word)) continue
    let stem = word
    if (/^[가-힣]+$/.test(word)) {
      for (const suffix of korean) if (word.length > suffix.length + 1 && word.endsWith(suffix)) { stem = word.slice(0, -suffix.length); break }
    } else if (/^[a-z][a-z0-9]+$/.test(word)) {
      for (const suffix of english) if (word.length > suffix.length + 3 && word.endsWith(suffix)) { stem = word.slice(0, -suffix.length); break }
    }
    result.push(stem)
  }
  return result
}

type Document = { id: string; counts: Map<string, number>; vector: Map<string, number>; top: string[] }

function documents(entries: Array<{ id: string; text: string }>) {
  const drafts: Document[] = []
  const frequency = new Map<string, number>()
  for (const entry of entries) {
    const counts = new Map<string, number>()
    for (const word of words(entry.text)) counts.set(word, (counts.get(word) ?? 0) + 1)
    for (const term of counts.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1)
    drafts.push({ id: entry.id, counts, vector: new Map(), top: [] })
  }
  const total = drafts.length
  for (const document of drafts) {
    let magnitude = 0
    const weights: Array<[string, number]> = []
    for (const [term, count] of document.counts) {
      // A word every note uses says nothing about any of them; log-idf takes it to zero on its own.
      const idf = Math.log(1 + total / (frequency.get(term) ?? 1))
      if (idf <= 0.02) continue
      const weight = (1 + Math.log(count)) * idf
      weights.push([term, weight])
      magnitude += weight * weight
    }
    magnitude = Math.sqrt(magnitude)
    if (!magnitude) continue
    weights.sort((left, right) => right[1] - left[1])
    for (const [term, weight] of weights.slice(0, topTermsPerNote)) document.vector.set(term, weight / magnitude)
    document.top = weights.slice(0, candidateTerms).map(([term]) => term)
  }
  return drafts
}

function cosine(left: Document, right: Document) {
  const [small, large] = left.vector.size <= right.vector.size ? [left, right] : [right, left]
  let score = 0
  const shared: Array<[string, number]> = []
  for (const [term, weight] of small.vector) {
    const other = large.vector.get(term)
    if (other === undefined) continue
    const part = weight * other
    score += part
    shared.push([term, part])
  }
  shared.sort((a, b) => b[1] - a[1])
  return { score, shared: shared.slice(0, 4).map(([term]) => term) }
}

/**
 * The threshold is read off the vault rather than fixed. Cosine values are not comparable between libraries —
 * a vault on one subject scores everything higher than a scattered one — so a constant cut either floods a
 * focused vault with suggestions or finds nothing in a broad one. Median plus a few median-deviations asks the
 * question that actually matters: which pairs are close *for this vault*.
 */
function cut(scores: number[]) {
  if (scores.length < 12) return { threshold: 0.22, median: 0, deviation: 0 }
  const sorted = [...scores].sort((left, right) => left - right)
  const median = sorted[Math.floor(sorted.length / 2)]
  const deviations = sorted.map((value) => Math.abs(value - median)).sort((left, right) => left - right)
  const deviation = deviations[Math.floor(deviations.length / 2)]
  return { threshold: Math.max(median + deviation * 4, 0.18), median, deviation }
}

export type MissingLinkRequest = { linked: Set<string>; limit?: number }

export async function suggestMissingLinks(libraryPath: string, request: MissingLinkRequest): Promise<SimilarityReport> {
  const snapshot = await readVaultSnapshot(libraryPath)
  return missingLinksFrom(snapshot.records, (id) => snapshot.contents.get(id) ?? '', request)
}

/** The same computation over state a caller already holds, so the graph does not read the vault twice. */
export function missingLinksFrom(records: KnowledgeNodeRecord[], content: (id: string) => string, request: MissingLinkRequest): SimilarityReport {
  const thin: string[] = []
  const usable: Array<{ id: string; text: string }> = []
  for (const record of records) {
    const text = `${record.title} ${authoredText(content(record.id))}`
    if (new Set(words(text)).size < minimumTerms) { thin.push(record.id); continue }
    usable.push({ id: record.id, text })
  }

  const docs = documents(usable).filter((document) => document.vector.size)
  const byId = new Map(docs.map((document) => [document.id, document]))
  // Candidates come from an inverted index on each note's most distinctive words, so a large vault never pays
  // for the pairs that could not have scored anyway.
  const postings = new Map<string, string[]>()
  for (const document of docs) for (const term of document.top) {
    const list = postings.get(term)
    if (list) list.push(document.id); else postings.set(term, [document.id])
  }

  const seen = new Set<string>()
  const scored: SimilarPair[] = []
  let compared = 0
  for (const document of docs) {
    const candidates = new Set<string>()
    for (const term of document.top) for (const other of postings.get(term) ?? []) if (other !== document.id) candidates.add(other)
    for (const otherId of candidates) {
      const key = document.id < otherId ? `${document.id}|${otherId}` : `${otherId}|${document.id}`
      if (seen.has(key) || request.linked.has(key)) continue
      seen.add(key)
      compared += 1
      const { score, shared } = cosine(document, byId.get(otherId)!)
      if (score > 0) scored.push({ a: document.id, b: otherId, score: Number(score.toFixed(4)), shared })
    }
  }

  const { threshold, median, deviation } = cut(scored.map((pair) => pair.score))
  const pairs = scored
    .filter((pair) => pair.score >= threshold)
    .sort((left, right) => right.score - left.score)
    .slice(0, request.limit ?? 40)
  return { pairs, measured: pairs.length, compared, threshold: Number(threshold.toFixed(4)), median: Number(median.toFixed(4)), deviation: Number(deviation.toFixed(4)), thin }
}
