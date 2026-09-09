export type ExcerptRect = { left: number; top: number; width: number; height: number }
/** Keep only the requested text slices, including partial first/last lines. */
export function excerptSlices(bounds: ExcerptRect, slices: ExcerptRect[]) {
  return slices.flatMap(slice => {
    const left = Math.max(bounds.left, slice.left); const top = Math.max(bounds.top, slice.top)
    const right = Math.min(bounds.left + bounds.width, slice.left + slice.width)
    const bottom = Math.min(bounds.top + bounds.height, slice.top + slice.height)
    return right > left && bottom > top ? [{ left, top, width: right - left, height: bottom - top }] : []
  })
}
export function mixedProseParagraphs(segments: Array<{ kind: string; blockId?: string }>) {
  const kinds = new Map<string, Set<string>>()
  for (const segment of segments) {
    if (!segment.blockId) continue
    const set = kinds.get(segment.blockId) ?? new Set<string>()
    set.add(segment.kind); kinds.set(segment.blockId, set)
  }
  return new Set([...kinds].filter(([, set]) => set.has('text') && set.has('artifact') && !set.has('equation') && !set.has('table')).map(([id]) => id))
}
export function alignedExcerptSlices(bounds: ExcerptRect, slices: readonly ExcerptRect[]) {
  return alignExcerptLines(slices, bounds).slices.map(({ sourceRect, destinationRect }) => ({ source: sourceRect, destination: destinationRect }))
}
export type ExcerptSlice = { sourceRect: ExcerptRect; destinationRect: ExcerptRect }

/** Exact pixel slices only; ambiguous geometry returns an identity plan for the caller's fallback. */
export function alignExcerptLines(rects: readonly ExcerptRect[], bounds: ExcerptRect): { slices: ExcerptSlice[]; aligned: boolean; reason?: 'invalid-geometry' | 'ambiguous-lines' } {
  const unchanged = (reason: 'invalid-geometry' | 'ambiguous-lines') => ({ slices: rects.map(rect => ({ sourceRect: { ...rect }, destinationRect: { ...rect } })), aligned: false, reason })
  const valid = (rect: ExcerptRect) => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0
  if (!valid(bounds) || rects.some(rect => !valid(rect) || rect.left < bounds.left - .01 || rect.top < bounds.top - .01 || rect.left + rect.width > bounds.left + bounds.width + .01 || rect.top + rect.height > bounds.top + bounds.height + .01)) return unchanged('invalid-geometry')
  if (!rects.length) return { slices: [], aligned: false }
  const lines: Array<{ rects: Array<{ rect: ExcerptRect; index: number }>; top: number; bottom: number }> = []
  // Establish full-height line bands before assigning smaller italic/symbol ink boxes.
  for (const item of rects.map((rect, index) => ({ rect, index })).sort((a, b) => b.rect.height - a.rect.height || a.rect.top - b.rect.top || a.rect.left - b.rect.left)) {
    const { rect } = item
    const matches = lines.filter(line => {
      const first = line.rects[0].rect
      const tolerance = Math.min(1, Math.min(first.height, rect.height) * .12)
      const sameBand = Math.abs(first.top - rect.top) <= tolerance && Math.abs(first.top + first.height - rect.top - rect.height) <= tolerance
      const containedInk = rect.top >= first.top - .01 && rect.top + rect.height <= first.top + first.height + .01
      return sameBand || containedInk
    })
    if (matches.length > 1) return unchanged('ambiguous-lines')
    if (matches.length === 1) {
      const line = matches[0]
      // Overlapping slices might be duplicated glyphs or unrelated runs; don't reposition them.
      if (line.rects.some(other => {
        const overlap = Math.min(other.rect.left + other.rect.width, rect.left + rect.width) - Math.max(other.rect.left, rect.left)
        const overhang = Math.min(1, Math.min(other.rect.width, rect.width) * .12)
        return overlap > overhang
      })) return unchanged('ambiguous-lines')
      line.rects.push(item); line.top = Math.min(line.top, rect.top); line.bottom = Math.max(line.bottom, rect.top + rect.height)
    } else lines.push({ rects: [item], top: rect.top, bottom: rect.top + rect.height })
  }
  const ordered = [...lines].sort((a, b) => a.top - b.top)
  if (ordered.some((line, i) => i > 0 && line.top < ordered[i - 1].bottom - .01)) return unchanged('ambiguous-lines')
  const slices: ExcerptSlice[] = Array(rects.length)
  let aligned = false
  for (const line of lines) {
    const dx = bounds.left - Math.min(...line.rects.map(item => item.rect.left))
    if (Math.abs(dx) > .01) aligned = true
    for (const { rect, index } of line.rects) slices[index] = { sourceRect: { ...rect }, destinationRect: { ...rect, left: rect.left + dx } }
  }
  return { slices, aligned }
}
