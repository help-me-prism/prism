/** Bibliographic lists are preserved as source, unless the reader explicitly translates that page. */
export function withoutBibliography<T extends { source: string; kind: string }>(segments: T[]): T[] {
  let bibliography = false
  return segments.filter(segment => {
    const heading = segment.source.trim().replace(/^\d+[.\s]+/, '')
    if (segment.kind === 'heading' && /^(references|bibliography|literature cited|참고문헌)$/i.test(heading)) bibliography = true
    else if (segment.kind === 'heading' && /^(appendi(?:x|ces)|supplement|supporting information)\b/i.test(heading)) bibliography = false
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
