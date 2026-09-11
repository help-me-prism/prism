export type FigureRect = { left: number; top: number; width: number; height: number }
export type FigureComponentMetrics = { relativeWidth?: number; row?: number; pixelWidth?: number; pixelHeight?: number }

export type FigureTextEvidence = { kind: string; source: string; rects: FigureRect[] }

/** PDF paths include frames, watermarks and backgrounds, not just diagrams.
 * A graphic's bounding box is not evidence that the prose inside it is a figure.
 * Use individual text rectangles so empty space between columns cannot veto a
 * real plot; short axis/panel labels and captions do not count as body prose. */
export function figureOverlapsProse(figure: FigureRect, evidence: FigureTextEvidence[]): boolean {
  return evidence.some(item => {
    if (!['text', 'heading'].includes(item.kind)) return false
    const words = item.source.match(/[\p{L}]{2,}/gu)?.length ?? 0
    if (words < (item.kind === 'heading' ? 8 : 12)) return false
    let area = 0, overlap = 0
    for (const rect of item.rects) {
      area += rect.width * rect.height
      overlap += Math.max(0, Math.min(figure.left + figure.width, rect.left + rect.width) - Math.max(figure.left, rect.left))
        * Math.max(0, Math.min(figure.top + figure.height, rect.top + rect.height) - Math.max(figure.top, rect.top))
    }
    return area > 0 && overlap / area > .2
  })
}

/** Include an adjacent caption above or below a figure. Horizontal alignment
 * and a bounded gap prevent unrelated prose from being absorbed. */
export function figureRegionWithCaption(figure: FigureRect, captionRects: FigureRect[], scale = 1): FigureRect {
  if (!captionRects.length) return figure
  const captionLeft = Math.min(...captionRects.map(rect => rect.left)); const captionTop = Math.min(...captionRects.map(rect => rect.top))
  const captionRight = Math.max(...captionRects.map(rect => rect.left + rect.width)); const captionBottom = Math.max(...captionRects.map(rect => rect.top + rect.height))
  const figureRight = figure.left + figure.width; const figureBottom = figure.top + figure.height
  const overlap = Math.max(0, Math.min(figureRight, captionRight) - Math.max(figure.left, captionLeft)) / Math.max(1, Math.min(figure.width, captionRight - captionLeft))
  const gap = Math.max(0, Math.max(figure.top, captionTop) - Math.min(figureBottom, captionBottom))
  if (overlap < .18 || gap > 72 * scale) return figure
  const left = Math.min(figure.left, captionLeft); const top = Math.min(figure.top, captionTop)
  return { left, top, width: Math.max(figureRight, captionRight) - left, height: Math.max(figureBottom, captionBottom) - top }
}

/** Estimate the printed bounds from the source's declared panel widths and
 * intrinsic aspect ratios. Unlike a fixed caption-upward crop, this cannot
 * swallow arbitrary prose or tables above a short figure. */
export function sourceFigureRegion(captionRects: FigureRect[], components: FigureComponentMetrics[], pageWidth: number, contentLeft: number, contentRight: number, scale: number, hasPanelLabels = false): FigureRect | undefined {
  if (!captionRects.length || !components.length || components.some(component => !component.pixelWidth || !component.pixelHeight)) return undefined
  const captionLeft = Math.min(...captionRects.map(rect => rect.left)); const captionTop = Math.min(...captionRects.map(rect => rect.top))
  const captionRight = Math.max(...captionRects.map(rect => rect.left + rect.width)); const contentWidth = Math.max(1, contentRight - contentLeft)
  const rows = new Map<number, FigureComponentMetrics[]>()
  for (const component of components) { const row = component.row ?? 0; rows.set(row, [...(rows.get(row) ?? []), component]) }
  const declared = components.every(component => typeof component.relativeWidth === 'number')
  const captionSpansPage = captionRight - captionLeft > pageWidth * .58
  const fallbackWidth = captionSpansPage ? contentWidth : Math.min(contentWidth * .48, pageWidth * .43)
  let width = 0; let height = 0
  for (const row of [...rows.values()]) {
    const relativeTotal = row.reduce((sum, component) => sum + (component.relativeWidth ?? 0), 0)
    const rowTarget = declared ? Math.min(contentWidth, relativeTotal * contentWidth) : fallbackWidth
    const weights = row.map(component => declared ? component.relativeWidth! : component.pixelWidth! / row.reduce((sum, item) => sum + item.pixelWidth!, 0))
    const rowWidths = weights.map(weight => declared ? weight * contentWidth : weight * rowTarget)
    const gap = Math.min(8 * scale, Math.max(2 * scale, rowTarget * .025)); const rowWidth = rowWidths.reduce((sum, value) => sum + value, 0) + gap * Math.max(0, row.length - 1)
    const rowHeight = Math.max(...row.map((component, index) => rowWidths[index] * component.pixelHeight! / component.pixelWidth!))
    width = Math.max(width, rowWidth); height += rowHeight + (hasPanelLabels ? 14 * scale : 3 * scale)
  }
  height += 6 * scale * Math.max(0, rows.size - 1)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 20 * scale || height < 15 * scale) return undefined
  const left = captionSpansPage || width > contentWidth * .68
    ? contentLeft + (contentWidth - width) / 2
    : Math.max(contentLeft, Math.min(contentRight - width, captionLeft - (width - (captionRight - captionLeft)) / 2))
  const bottom = captionTop - 4 * scale
  return { left: Math.max(0, left), top: Math.max(4 * scale, bottom - height), width: Math.min(width, pageWidth), height }
}

/** Join raster panels that form one nearby, aligned multi-panel figure. */
export function joinBitmapRegions(rects: FigureRect[], scale: number, pageArea: number) {
  const groups: FigureRect[] = []
  for (const rect of rects) {
    let next = { ...rect }
    for (let index = 0; index < groups.length;) {
      const other = groups[index]
      const horizontalGap = Math.max(0, Math.max(next.left, other.left) - Math.min(next.left + next.width, other.left + other.width))
      const verticalGap = Math.max(0, Math.max(next.top, other.top) - Math.min(next.top + next.height, other.top + other.height))
      const horizontalOverlap = Math.max(0, Math.min(next.left + next.width, other.left + other.width) - Math.max(next.left, other.left)) / Math.max(1, Math.min(next.width, other.width))
      const verticalOverlap = Math.max(0, Math.min(next.top + next.height, other.top + other.height) - Math.max(next.top, other.top)) / Math.max(1, Math.min(next.height, other.height))
      const alignedPanels = (verticalOverlap >= .55 && horizontalGap <= 24 * scale) || (horizontalOverlap >= .65 && verticalGap <= 18 * scale)
      const left = Math.min(next.left, other.left); const top = Math.min(next.top, other.top)
      const union = { left, top, width: Math.max(next.left + next.width, other.left + other.width) - left, height: Math.max(next.top + next.height, other.top + other.height) - top }
      if (alignedPanels && union.width * union.height < pageArea * .78) { next = union; groups.splice(index, 1); index = 0 } else index += 1
    }
    groups.push(next)
  }
  return groups
}
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
