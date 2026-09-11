/** Bibliographic lists are preserved as source, for both whole-document and page translation. */
/** A bibliography entry, recognised by the apparatus every citation style
 * carries rather than by the language it is written in: a publication year,
 * plus at least one of an entry number, an author initial, "et al.", a DOI or
 * arXiv id, a page range, or a volume(issue) — inside a segment short enough to
 * be a single entry. */
function looksLikeReferenceEntry(source: string) {
  const text = source.trim()
  if (!text || text.length > 500) return false
  if (!/\b(?:1[89]|20)\d{2}\b/.test(text)) return false
  return /^\[\d{1,3}\]/.test(text)
    || /^\d{1,3}\.\s/.test(text)
    || /\b\p{Lu}\./u.test(text)
    || /\bet\s+al\b/i.test(text)
    || /\b(?:doi|arxiv)\b/i.test(text)
    || /\b\d{1,4}\s*[–—-]\s*\d{1,4}\b/.test(text)
    || /\b\d+\s*\(\s*\d+\s*\)/.test(text)
}

export function withoutBibliography<T extends { source: string; kind: string }>(segments: T[]): T[] {
  let bibliography = false
  // Some journal PDFs omit a References title. Require a consecutive numbered
  // list with publication-year evidence, not an isolated inline citation.
  const unlabeledStart = segments.findIndex((segment, index) => {
    if (!/^\[1\]\s+[A-Z]/.test(segment.source.trim())) return false
    const following = segments.slice(index, index + 45)
    const labels = following.flatMap(item => { const match = item.source.trim().match(/^\[(\d+)\]\s+[A-Z]/); return match ? [Number(match[1])] : [] })
    return labels[0] === 1 && labels[1] === 2 && labels[2] === 3 && following.filter(item => /\b(?:19|20)\d{2}\b/.test(item.source)).length >= 3
  })
  // The heading rule below needs the title to be its own segment, and Nature
  // runs it into the first entry ("References [1] Jimmy Lei Ba, ..."), which
  // sent an entire bibliography to the translator. A run of entries is evidence
  // on its own, and unlike a title it reads the same in every language. One
  // citation inside a sentence is not a run, so most of a window must qualify.
  const runStart = segments.findIndex((segment, index) => {
    if (!looksLikeReferenceEntry(segment.source)) return false
    const window = segments.slice(index, index + 6)
    return window.length >= 4 && window.filter(item => looksLikeReferenceEntry(item.source)).length >= 4
  })
  const detectedStart = Math.min(...[unlabeledStart, runStart].filter(index => index >= 0), Number.MAX_SAFE_INTEGER)
  // What follows a bibliography is usually an appendix, and its title is not
  // always one the heading rule below knows ("Attention Visualizations"). The
  // run has to end structurally too, or excluding it swallows the appendix:
  // two segments in a row that read as body — a title, or a full sentence with
  // no citation apparatus — mean the entries have stopped.
  const resumesBody = (segment: T) => !looksLikeReferenceEntry(segment.source)
    && !/^(?:\[\d{1,3}\]|\d{1,3}\.\s)/.test(segment.source.trim())
    && (segment.kind === 'heading' || (segment.source.match(/[\p{L}]{2,}/gu)?.length ?? 0) >= 8)
  // A run of body segments is not enough evidence on its own. One entry is split
  // across several segments, and the middle pieces of a long one carry neither a
  // year nor a citation mark, so three in a row read as body in the middle of a
  // bibliography and put the rest of it back into translation. The run has to be
  // backed by the entries actually stopping: almost none in the window ahead.
  let detectedEnd = segments.length
  for (let index = detectedStart + 1; index + 3 <= segments.length; index += 1) {
    const ahead = segments.slice(index, index + 10)
    if (ahead.filter(item => looksLikeReferenceEntry(item.source)).length > 1) continue
    if (!segments.slice(index, index + 3).every(resumesBody)) continue
    detectedEnd = index; break
  }
  // The two ways of finding a bibliography are tracked apart. A detected run
  // ends where the entries stop; a titled one ends where the title rules below
  // say it does. Letting the run's ending clear a titled bibliography as well
  // released most of a PLOS reference list back into translation, because the
  // run had started on a false positive earlier in the body and ended long
  // before the real list began.
  let inDetectedRun = false
  return segments.filter((segment, index) => {
    if (index === detectedStart) inDetectedRun = true
    else if (index === detectedEnd) inDetectedRun = false
    const heading = segment.source.trim().replace(/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+/, '')
    if (segment.kind === 'heading' && /^(references(?: and notes)?|bibliography|literature cited|참고문헌)$/i.test(heading)) bibliography = true
    else if (segment.kind === 'heading' && (/^(appendi(?:x|ces)|supplement|supporting information)\b/i.test(heading) || /^[A-Z](?:\.\d+)*\.?\s+[A-Z]/.test(heading))) { bibliography = false; inDetectedRun = false }
    else if (segment.kind === 'caption' && /^(?:fig(?:ure)?\.?|table|algorithm)\s*(?:\d+|[IVX]+)\b/i.test(heading)) { bibliography = false; inDetectedRun = false }
    return !bibliography && !inDetectedRun
  })
}
/** Proportional PDF text slices cannot safely locate individual glyph boundaries. */
export function unsafeParagraphIds<T extends { kind: string; blockId?: string; preciseRects?: Array<{ left: number; top: number; width: number; height: number; fontSize: number }>; itemSlices?: Array<{ start: number; end: number }> }>(segments: T[]): Set<string> {
  const paragraphs = new Map<string, T[]>()
  for (const segment of segments) {
    if (!segment.blockId) continue
    const items = paragraphs.get(segment.blockId) ?? []
    items.push(segment); paragraphs.set(segment.blockId, items)
  }
  return new Set([...paragraphs].filter(([, items]) =>
    items.some(item => item.kind === 'text') && items.some(item => item.kind === 'artifact') &&
    !items.some(item => item.kind === 'equation' || item.kind === 'table') &&
    items.some(item => item.itemSlices?.some(slice => slice.start > 0 || slice.end < 1)) &&
    !items.every(item => item.preciseRects?.length && item.preciseRects.every(rect => [rect.left, rect.top, rect.width, rect.height, rect.fontSize].every(Number.isFinite) && rect.width > 0 && rect.height > 0 && rect.fontSize > 0))
  ).map(([id]) => id))
}
