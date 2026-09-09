export type ItemRect = { left: number; top: number; width: number; height: number; fontSize?: number; text?: string }

/** Interaction bounds may have a minimum size; typography must retain the PDF em. */
export function textItemRect(tx: number[], width: number, scale: number, ascent: number, text: string): ItemRect {
  const fontSize = Math.hypot(tx[2], tx[3])
  const height = Math.max(5, fontSize)
  return { left: tx[4], top: tx[5] - height * ascent, width: Math.max(2, width * scale), height, fontSize, text }
}

export function segmentRects(segment: {
  preciseRects?: Array<ItemRect & { fontSize: number }>;
  itemSlices?: Array<{ itemIndex: number; start: number; end: number }>;
  itemIndexes?: number[];
}, itemRects: ItemRect[], scale = 1): ItemRect[] {
  if (segment.preciseRects?.length) return segment.preciseRects.map(rect => ({ left: rect.left * scale, top: rect.top * scale, width: rect.width * scale, height: rect.height * scale, fontSize: rect.fontSize * scale }))
  if (segment.itemSlices?.length) return segment.itemSlices.flatMap(slice => {
    const rect = itemRects[slice.itemIndex]
    return rect ? [{ left: rect.left + rect.width * slice.start, top: rect.top, width: Math.max(2, rect.width * (slice.end - slice.start)), height: rect.height, fontSize: rect.fontSize }] : []
  })
  return (segment.itemIndexes ?? []).map(index => itemRects[index]).filter(Boolean).map(({ text: _text, ...rect }) => rect)
}
