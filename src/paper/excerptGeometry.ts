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
