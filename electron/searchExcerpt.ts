const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** Search normalized text, but always display a slice of the unmodified source. */
export function searchExcerpt(source: string, query: string, budget = 240): string {
  if (!source) return ''
  const offsets: { start: number; end: number }[] = []
  const boundaries: number[] = [0]
  let folded = ''
  for (const part of graphemes.segment(source)) {
    boundaries.push(part.index + part.segment.length)
    const text = part.segment.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
    for (const char of text) {
      if (char === ' ' && (!folded || folded.endsWith(' '))) continue
      folded += char
      // String#indexOf uses UTF-16 offsets, including for astral letters.
      for (let i = 0; i < char.length; i++) offsets.push({ start: part.index, end: part.index + part.segment.length })
    }
  }
  const phrase = normalize(query)
  let needle = phrase
  let hit = phrase ? folded.indexOf(phrase) : -1
  if (hit < 0) for (const word of phrase.split(' ').filter(Boolean).sort((a, b) => b.length - a.length)) {
    const index = folded.indexOf(word)
    if (index >= 0) { hit = index; needle = word; break }
  }
  const matchStart = hit < 0 ? 0 : offsets[hit].start
  const matchEnd = hit < 0 ? 0 : offsets[hit + needle.length - 1].end
  let start = Math.max(0, matchStart - 35)
  let end = Math.min(source.length, start + budget)
  // Prefer a whole matching sentence over an arbitrary character window.
  for (const part of sentences.segment(source)) {
    if (part.index > matchStart) break
    const sentenceEnd = part.index + part.segment.length
    if (sentenceEnd >= matchEnd && sentenceEnd > matchStart && part.segment.length <= budget && matchStart - part.index <= 60) {
      start = part.index; end = sentenceEnd; break
    }
  }
  // Expand to ordinary word boundaries, but bound pathological unbroken text.
  const earliest = Math.max(0, start - 40), latest = Math.min(source.length, end + 40)
  while (start > earliest && !/\s/u.test(source[start - 1])) start--
  while (end < latest && !/\s/u.test(source[end])) end++
  start = boundaries.find(value => value >= start) ?? source.length
  for (let i = boundaries.length - 1; i >= 0; i--) if (boundaries[i] <= end) { end = boundaries[i]; break }
  const text = source.slice(start, end).trim()
  return `${source.slice(0, start).trim() ? '…' : ''}${text}${source.slice(end).trim() ? '…' : ''}`
}
