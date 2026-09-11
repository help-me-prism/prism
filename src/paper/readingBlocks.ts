/** Preserve source order when a paragraph contains protected figures or damaged glyphs. */
export function groupReadingSegments<T extends { id: string; kind: string; source?: string; blockId?: string; preciseRects?: Array<{ left: number; top: number; width: number; height: number }> }>(segments: T[], originalParagraphs = new Set<string>(), partition?: (segment: T) => string) {
  const groups: Array<{ id: string; key: string; kind: string; items: T[]; original: boolean }> = []
  const theoremBlocks = new Set(segments.filter(segment => /^(?:Theorem|Lemma|Proposition|Corollary|Definition)\s+\d+/i.test(segment.source?.trim() ?? '')).map(segment => segment.blockId).filter(Boolean))
  for (const [index, segment] of segments.entries()) {
    const original = !!segment.blockId && originalParagraphs.has(segment.blockId)
    const next = segments[index + 1]
    const headingLine = segment.preciseRects?.length === 1 ? segment.preciseRects[0] : undefined
    const firstLine = next?.preciseRects?.[0]
    // A run-in heading shares its first line with the paragraph. Rendering it
    // in its narrow original word box wraps the translation and can reorder it
    // after the body because bold glyphs have a slightly lower ink top.
    const runIn = segment.kind === 'heading' && next?.kind === 'text' && !!segment.blockId && segment.blockId === next.blockId
      && headingLine && firstLine && firstLine.left >= headingLine.left + headingLine.width - 1
      && Math.abs(firstLine.top - headingLine.top) < Math.min(firstLine.height, headingLine.height) * .4
    const theorem = !!segment.blockId && theoremBlocks.has(segment.blockId)
    const kind = theorem ? 'theorem' : runIn ? 'text' : segment.kind
    // A theorem is one semantic block even when its final inline expression was
    // emitted by PDF.js as an equation-shaped segment.
    const preserved = ['artifact', 'equation', 'table'].includes(kind)
    const key = `${original ? 'original' : kind}-${segment.blockId ?? segment.id}${!original && !theorem && !preserved && partition ? '-' + partition(segment) : ''}`
    const previous = groups.at(-1)
    if (previous?.key === key) previous.items.push(segment)
    else groups.push({ id: `${key}-run-${groups.length}`, key, kind, items: [segment], original })
  }
  return groups
}
