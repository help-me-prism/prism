export type FlowGlyphRect = { left: number; top: number; width: number; height: number; fontSize?: number }
export type FlowProseLine = { rect: FlowGlyphRect; slices: FlowGlyphRect[]; widthEm: number; heightEm: number }

/** Only entirely white, word-sized gutters are safe breaks; tiny letter gaps stay intact. */
export function blankGutterPieces(rgba: Uint8ClampedArray, width: number, height: number, fontPixels: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4 || !Number.isFinite(fontPixels) || fontPixels <= 0) return []
  const blank = (x: number) => {
    for (let y = 0; y < height; y++) {
      const i = (y * width + x) * 4
      if (rgba[i + 3] !== 0 && (rgba[i] !== 255 || rgba[i + 1] !== 255 || rgba[i + 2] !== 255)) return false
    }
    return true
  }
  const cuts = [0]; const minimumGap = Math.max(2, Math.ceil(fontPixels * .22))
  for (let x = 0; x < width;) {
    if (!blank(x)) { x++; continue }
    const start = x
    while (x < width && blank(x)) x++
    if (start > 0 && x < width && x - start >= minimumGap) cuts.push(Math.floor((start + x) / 2))
  }
  cuts.push(width)
  return cuts.slice(0, -1).map((left, index) => ({ left, width: cuts[index + 1] - left }))
}

/** Scale exact source pixels by the source font em, never by the paragraph's width. */
export function flowProseLines(rects: readonly FlowGlyphRect[]): FlowProseLine[] | undefined {
  if (!rects.length || rects.some(rect => ![rect.left, rect.top, rect.width, rect.height, rect.fontSize].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || !rect.fontSize || rect.fontSize <= 0)) return undefined
  const sizes = rects.map(rect => rect.fontSize!).sort((a, b) => a - b)
  const fontSize = sizes[Math.floor(sizes.length / 2)]
  const lines: FlowGlyphRect[][] = []
  for (const rect of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const matches = lines.filter(line => line.some(other => Math.min(other.top + other.height, rect.top + rect.height) - Math.max(other.top, rect.top) > Math.min(other.height, rect.height) * .5))
    if (matches.length > 1) return undefined
    if (matches.length) matches[0].push(rect)
    else lines.push([rect])
  }
  return lines.map(slices => {
    slices.sort((a, b) => a.left - b.left)
    const left = Math.min(...slices.map(rect => rect.left)); const top = Math.min(...slices.map(rect => rect.top))
    const width = Math.max(...slices.map(rect => rect.left + rect.width)) - left
    const height = Math.max(...slices.map(rect => rect.top + rect.height)) - top
    return { rect: { left, top, width, height, fontSize }, slices, widthEm: width / fontSize, heightEm: height / fontSize }
  })
}
