export type ItemRect = { left: number; top: number; width: number; height: number; fontSize?: number; text?: string; vertical?: boolean; reverse?: boolean }

/** Interaction bounds may have a minimum size; typography must retain the PDF em. */
export function textItemRect(tx: number[], width: number, scale: number, ascent: number, text: string): ItemRect {
  const fontSize = Math.hypot(tx[2], tx[3])
  const height = Math.max(5, fontSize)
  if (Math.abs(tx[1]) < .001 && tx[0] >= 0) return { left: tx[4], top: tx[5] - height * ascent, width: Math.max(2, width * scale), height, fontSize, text }
  // Manuscript stamps and rotated labels advance along the transformed
  // baseline. Treating their width as horizontal crops into the body column.
  const advance = Math.max(1e-9, Math.hypot(tx[0], tx[1]))
  const ux = tx[0] / advance, uy = tx[1] / advance
  const vx = tx[2] / Math.max(1e-9, fontSize), vy = tx[3] / Math.max(1e-9, fontSize)
  const length = Math.max(2, width * scale)
  const corners = [0, length].flatMap(along => [-height * (1 - ascent), height * ascent].map(across => ({ x: tx[4] + ux * along + vx * across, y: tx[5] + uy * along + vy * across })))
  const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y))
  const vertical = Math.abs(uy) > Math.abs(ux)
  return { left, top, width: Math.max(...corners.map(p => p.x)) - left, height: Math.max(...corners.map(p => p.y)) - top, fontSize, text, vertical, reverse: vertical ? uy < 0 : ux < 0 }
}

export function segmentRects(segment: {
  preciseRects?: Array<ItemRect & { fontSize: number }>;
  itemSlices?: Array<{ itemIndex: number; start: number; end: number }>;
  itemIndexes?: number[];
}, itemRects: ItemRect[], scale = 1): ItemRect[] {
  if (segment.preciseRects?.length) return segment.preciseRects.map(rect => ({ left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale, fontSize: rect.fontSize * scale }))
  if (segment.itemSlices?.length) return segment.itemSlices.flatMap(slice => {
    const rect = itemRects[slice.itemIndex]
    if (!rect) return []
    const start = rect.reverse ? 1 - slice.end : slice.start
    return [rect.vertical
      ? { left: rect.left, top: rect.top + rect.height * start, width: rect.width, height: Math.max(2, rect.height * (slice.end - slice.start)), fontSize: rect.fontSize }
      : { left: rect.left + rect.width * start, top: rect.top, width: Math.max(2, rect.width * (slice.end - slice.start)), height: rect.height, fontSize: rect.fontSize }]
  })
  return (segment.itemIndexes ?? []).map(index => itemRects[index]).filter(Boolean).map(({ text: _text, ...rect }) => rect)
}
