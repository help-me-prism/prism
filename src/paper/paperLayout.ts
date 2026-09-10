export type PaperRect = { left: number; top: number; width: number; height: number }

/** Recover regular prose leading from ink bands, excluding raised/small glyphs.
 * Ambiguous columns, mixed sizes or paragraph gaps retain the CSS fallback. */
export function sourceParagraphLineHeight(rects: Array<PaperRect & { fontSize?: number }>, renderedFontSize: number): number | undefined {
  if (!(renderedFontSize > 0) || !Number.isFinite(renderedFontSize) || rects.some(rect => ![rect.left, rect.top, rect.width, rect.height, rect.fontSize].every(value => typeof value === 'number' && Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0)) return undefined
  const sizes = rects.map(rect => rect.fontSize!).sort((a, b) => a - b)
  const em = sizes[Math.floor(sizes.length / 2)]
  if (!(em > 0)) return undefined
  const body = rects.filter(rect => Math.abs(rect.fontSize! - em) <= em * .1 && rect.height >= em * .65)
  if (body.length < rects.length * .75) return undefined
  const lines: Array<{ top: number; representativeTop: number; representativeWidth: number; left: number; right: number }> = []
  for (const rect of [...body].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(line => Math.abs(line.top - rect.top) < em * .35)
    if (line) {
      line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.left + rect.width)
      if (rect.width > line.representativeWidth) { line.representativeTop = rect.top; line.representativeWidth = rect.width }
    } else lines.push({ top: rect.top, representativeTop: rect.top, representativeWidth: rect.width, left: rect.left, right: rect.left + rect.width })
  }
  if (lines.length < 3) return undefined
  // Subsequent lines must establish one column, not alternate between columns.
  const continuationLeft = lines[1].left
  if (lines.slice(1).some(line => Math.abs(line.left - continuationLeft) > em * .25)
    || Math.abs(lines[0].left - continuationLeft) > em * 3) return undefined
  // A short rho/subscript run can have a lower ink top with the same nominal
  // font size. The widest prose run establishes each line's representative top.
  const tops = lines.map(line => line.representativeTop)
  const pitches = tops.slice(1).map((top, index) => top - tops[index])
  const pitch = [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]
  if (pitch < em * 1.05 || pitch > em * 1.8 || pitches.some(value => Math.abs(value - pitch) > em * .12)) return undefined
  // Korean needs breathing room even when the Latin source has tight leading.
  // Preserve unusually tall actual ink as well; never squeeze symbols to fit.
  return Math.max(1.35, pitch / renderedFontSize, Math.max(...body.map(rect => rect.height)) / renderedFontSize + .15)
}

/** Infer only a conventional paragraph indent, never a partial sentence's offset. */
export function sourceParagraphIndent(rects: Array<PaperRect & { fontSize?: number }>) {
  const valid = rects.filter(rect => rect.width > 0 && rect.height > 0)
  const sizes = valid.map(rect => rect.fontSize ?? rect.height).filter(size => size > 0).sort((a, b) => a - b)
  const em = sizes[Math.floor(sizes.length / 2)]
  if (!em) return 0
  const lines: Array<{ top: number; left: number; right: number }> = []
  for (const rect of [...valid].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find(item => Math.abs(item.top - rect.top) < em * .45)
    if (line) { line.left = Math.min(line.left, rect.left); line.right = Math.max(line.right, rect.left + rect.width) }
    else lines.push({ top: rect.top, left: rect.left, right: rect.left + rect.width })
  }
  if (lines.length < 3) return 0
  const rest = lines.slice(1)
  const left = Math.min(...rest.map(line => line.left))
  if (rest.some(line => Math.abs(line.left - left) > em * .15)) return 0
  const indent = lines[0].left - left
  // A sentence beginning halfway across the PDF line is not an indentation.
  if (indent < em * .4 || indent > em * 3) return 0
  return indent
}

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
