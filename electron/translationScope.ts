/** Bibliographic lists are preserved as source, for both whole-document and page translation. */
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
  return segments.filter((segment, index) => {
    if (index === unlabeledStart) bibliography = true
    const heading = segment.source.trim().replace(/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+/, '')
    if (segment.kind === 'heading' && /^(references(?: and notes)?|bibliography|literature cited|참고문헌)$/i.test(heading)) bibliography = true
    else if (segment.kind === 'heading' && (/^(appendi(?:x|ces)|supplement|supporting information)\b/i.test(heading) || /^[A-Z](?:\.\d+)*\.?\s+[A-Z]/.test(heading))) bibliography = false
    else if (segment.kind === 'caption' && /^(?:fig(?:ure)?\.?|table|algorithm)\s*(?:\d+|[IVX]+)\b/i.test(heading)) bibliography = false
    return !bibliography
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
