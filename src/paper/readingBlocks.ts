/** Preserve source order when a paragraph contains protected figures or damaged glyphs. */
export function groupReadingSegments<T extends { id: string; kind: string; blockId?: string }>(segments: T[], originalParagraphs = new Set<string>()) {
  const groups: Array<{ id: string; key: string; items: T[]; original: boolean }> = []
  for (const segment of segments) {
    const original = !!segment.blockId && originalParagraphs.has(segment.blockId)
    const key = `${original ? 'original' : segment.kind}-${segment.blockId ?? segment.id}`
    const previous = groups.at(-1)
    if (previous?.key === key) previous.items.push(segment)
    else groups.push({ id: `${key}-run-${groups.length}`, key, items: [segment], original })
  }
  return groups
}
