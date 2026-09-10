export type FigureRect = { left: number; top: number; width: number; height: number }
/** Join touching vector strokes into regions, without joining neighbouring columns. */
export function joinVectorRegions(rects: FigureRect[], scale: number, pageArea: number) {
  const groups: FigureRect[] = []
  const gap = 6 * scale
  for (const rect of rects.slice(0, 1500)) {
    // Page backgrounds/clip paths touch every scientific stroke. Joining them
    // first turns all tables into a page-sized region that the final filter
    // discards. Such bounds are not eligible figures in the first place.
    if (rect.width * rect.height >= pageArea * .78) continue
    let next = { ...rect }
    for (let i = 0; i < groups.length;) {
      const other = groups[i]
      if (next.left <= other.left + other.width + gap && next.left + next.width + gap >= other.left && next.top <= other.top + other.height + gap && next.top + next.height + gap >= other.top) {
        const left = Math.min(next.left, other.left); const top = Math.min(next.top, other.top)
        next = { left, top, width: Math.max(next.left + next.width, other.left + other.width) - left, height: Math.max(next.top + next.height, other.top + other.height) - top }
        groups.splice(i, 1); i = 0
      } else i++
    }
    groups.push(next)
  }
  return groups.filter(rect => rect.width > 30 * scale && rect.height > 20 * scale && rect.width * rect.height > 1500 * scale * scale && rect.width * rect.height < pageArea * .78)
}
