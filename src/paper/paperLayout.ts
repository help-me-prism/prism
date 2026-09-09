export type PaperRect = { left: number; top: number; width: number; height: number }

/** Keep horizontal source geometry; expand only the space needed by translated text. */
export function placePaperBlocks(rects: PaperRect[], heights: number[], ratio: number) {
  const positions = new Array<number>(rects.length)
  const ordered = rects.map((rect, index) => ({ rect, index })).sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  const placed: typeof ordered = []
  for (const item of ordered) {
    let top = item.rect.top * ratio
    for (const prior of placed) {
      const overlap = Math.min(prior.rect.left + prior.rect.width, item.rect.left + item.rect.width) - Math.max(prior.rect.left, item.rect.left)
      if (overlap <= Math.min(prior.rect.width, item.rect.width) * .08) continue
      // Keep the original top whenever the translated paragraph still fits in
      // the available whitespace. Reapplying the entire original gap after a
      // taller paragraph needlessly pushes every subsequent block down.
      const gap = Math.min(6 * ratio, Math.max(0, (item.rect.top - prior.rect.top - prior.rect.height) * ratio))
      top = Math.max(top, positions[prior.index] + heights[prior.index] + gap)
    }
    positions[item.index] = top
    placed.push(item)
  }
  return positions
}

/** Move a pixel-crop edge outside every glyph it crosses, including omitted metadata. */
export function clearCropBoundary(edge: number, rects: PaperRect[], direction: 'before' | 'after') {
  let next = edge
  for (let pass = 0; pass <= rects.length; pass++) {
    const crossing = rects.filter(rect => rect.top - 2 < next && rect.top + rect.height + 2 > next)
    if (!crossing.length) break
    const moved = direction === 'before' ? Math.min(...crossing.map(rect => rect.top - 2)) : Math.max(...crossing.map(rect => rect.top + rect.height + 2))
    if (moved === next) break
    next = moved
  }
  return next
}
