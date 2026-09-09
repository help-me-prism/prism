export type PreservedRect = { left: number; top: number; width: number; height: number }
type Region = { id: string; items: Array<{ kind: string }>; rect?: PreservedRect }
const preserved = (region: Region) => region.items.every(item => ['equation', 'table', 'artifact'].includes(item.kind))

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
