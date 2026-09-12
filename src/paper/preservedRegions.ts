export type PreservedRect = { left: number; top: number; width: number; height: number }
type Region = { id: string; items: Array<{ kind: string; blockId?: string }>; rect?: PreservedRect }
const preserved = (region: Region) => region.items.every(item => ['equation', 'table', 'artifact'].includes(item.kind) && !item.blockId?.startsWith('furniture-'))

export function preservedRegionKind(items: Array<{ kind: string }>, fallback: string) {
  if (!items.every(item => ['equation', 'table', 'artifact'].includes(item.kind))) return fallback
  return items.some(item => item.kind === 'table') ? 'table' : items.some(item => item.kind === 'equation') ? 'equation' : fallback
}

/** Reassemble adjacent original-pixel fragments before cropping a fraction or table. */
export function joinPreservedRegions<T extends Region>(regions: T[]): T[] {
  const result: T[] = []
  for (const region of regions) {
    const previous = result.at(-1)
    if (previous?.rect && region.rect && preserved(previous) && preserved(region)) {
      const a = previous.rect; const b = region.rect
      const overlap = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
      const verticalGap = Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height)
      // Short fraction rows can have different widths. Require real horizontal
      // overlap, not merely nearby columns; text blocks always stop the join.
      if (overlap > Math.min(a.width, b.width) * .15 && verticalGap <= Math.max(6, Math.min(a.height, b.height) * 1.1)) {
        const left = Math.min(a.left, b.left); const top = Math.min(a.top, b.top)
        result[result.length - 1] = { ...previous, id: `${previous.id}+${region.id}`, items: [...previous.items, ...region.items], rect: { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top } }
        continue
      }
    }
    result.push(region)
  }
  return result
}

/** Merge preserved regions that occupy the same block of the page.
 *
 * joinPreservedRegions only joins neighbours in reading order, which is what
 * keeps prose from swallowing a table. But PDF text order walks a table's cells
 * by column as often as by row, so the rows of one table arrive interleaved and
 * never end up adjacent — Table 3 of Attention Is All You Need came out as four
 * regions over one grid, and the reader drew four markers on it.
 *
 * Overlapping geometry is the evidence that survives that reordering. Regions
 * merge only when they overlap horizontally and touch vertically, and never
 * across a `blocked` band — the caller passes the prose lines, so a table above
 * a paragraph cannot reach one below it.
 */
export function mergeOverlappingRegions<T extends Region>(regions: T[], blocked: PreservedRect[] = []): T[] {
  const result = regions.map(region => ({ ...region }))
  for (let changed = true; changed;) {
    changed = false
    outer: for (let i = 0; i < result.length; i += 1) {
      for (let j = i + 1; j < result.length; j += 1) {
        const a = result[i].rect, b = result[j].rect
        if (!a || !b) continue
        const overlap = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) / Math.max(1, Math.min(a.width, b.width))
        const gap = Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height)
        if (overlap <= .4 || gap > 14) continue
        const top = Math.min(a.top, b.top), bottom = Math.max(a.top + a.height, b.top + b.height)
        const left = Math.min(a.left, b.left), right = Math.max(a.left + a.width, b.left + b.width)
        if (blocked.some(band => band.top > top + 1 && band.top + band.height < bottom - 1
          && Math.max(0, Math.min(right, band.left + band.width) - Math.max(left, band.left)) > band.width * .3)) continue
        result[i] = { ...result[i], id: `${result[i].id}+${result[j].id}`, items: [...result[i].items, ...result[j].items], rect: { left, top, width: right - left, height: bottom - top } }
        result.splice(j, 1); changed = true
        break outer
      }
    }
  }
  return result
}
