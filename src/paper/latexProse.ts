/** Enrich only the same prose sentence. TeX is optional evidence, never a
 * replacement for an only loosely related PDF paragraph or code listing. */
export function latexSentenceSource(source: string, pdfSource: string): string | undefined {
  if (/^\d+\s*:|^Algorithm\b|\b(?:plt\.|Sequential\(|Dense\()/.test(pdfSource)) return undefined
  // Mask math without changing offsets, including punctuation inside delimiters.
  const math = /\$\$[\s\S]*?\$\$|(?<!\\)\$[^$]*?(?<!\\)\$|\\\([\s\S]*?\\\)/g
  const masked = source.replace(math, value => 'M'.repeat(value.length - 1) + (/[.!?](?:\$|\\\))$/.test(value) ? value.match(/[.!?](?=\$|\\\))/)![0] : 'M'))
  if (/(?<!\\)\$/.test(masked)) return undefined
  const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(masked)]
  const words = (value: string) => new Set(value.replace(math, ' ').replace(/\[[^\]]+\]/g, ' ').toLowerCase().match(/[a-z]{3,}/g) ?? [])
  const pdfWords = words(pdfSource)
  if (pdfWords.size < 4) return undefined
  const citations = pdfSource.match(/\[[^\]]+\]/g) ?? []
  for (const part of parts) {
    let candidate = source.slice(part.index, part.index + part.segment.length).trim()
    if (!/\$|\\\(/.test(candidate) || /\\(?:begin|end)|\b(?:plt\.|def |Dense\(|Sequential\()/.test(candidate)) continue
    const candidateCitations = candidate.match(/\[[^\]]+\]/g)?.filter(c => !/\\|\$/.test(c)) ?? []
    // Bibliography keys are not reader-facing citations. Only map an equal
    // number of citations; mismatches are evidence of a different sentence.
    if (candidateCitations.length !== citations.length) continue
    let citationIndex = 0
    candidate = candidate.replace(/\[[^\]]+\]/g, c => /\\|\$/.test(c) ? c : citations[citationIndex++])
    const candidateWords = words(candidate)
    const shared = [...candidateWords].filter(word => pdfWords.has(word)).length
    if (shared / candidateWords.size < .88 || shared / pdfWords.size < .82) continue
    return candidate
  }
  return undefined
}
