export type GlyphRect = { left: number; top: number; width: number; height: number; fontSize: number }
export type PaintedGlyph = { char: string; x: number; y: number; font: string; matrix: number[]; metrics: { left: number; right: number; ascent: number; descent: number } }
export type SourceGlyph = { unicode: string; fontChar: string; fontRef: string }
export type GlyphTextItem = { str: string; height: number }
export type GlyphSegment = { id: string; itemSlices?: Array<{ itemIndex: number; start: number; end: number }>; itemIndexes?: number[] }
export type GlyphGeometryResult = { ok: true; rectangles: Map<string, GlyphRect[]> } | { ok: false; reason: string }
const normalize = (text: string) => text.normalize('NFKC').replace(/\s/gu, '')

/** Only an exact paint/source match can replace the conservative original crop. */
export function alignGlyphGeometry(expected: SourceGlyph[], painted: PaintedGlyph[], items: GlyphTextItem[], segments: GlyphSegment[]): GlyphGeometryResult {
  const fail = (reason: string): GlyphGeometryResult => ({ ok: false, reason })
  if (!expected.length || expected.length !== painted.length) return fail('Glyph paint count differs from PDF operators')
  if (expected.some((glyph, i) => glyph.fontChar !== painted[i].char || !painted[i].font.split(/[\s,"']+/).includes(glyph.fontRef))) return fail('Glyph paint or embedded font differs from PDF operators')
  if (painted.some(g => g.matrix.length !== 6 || ![g.x,g.y,...g.matrix,...Object.values(g.metrics)].every(Number.isFinite))) return fail('Invalid glyph geometry')
  if (painted.some(g => Math.abs(g.matrix[1]) > .00001 || Math.abs(g.matrix[2]) > .00001 || g.matrix[0] <= 0 || g.matrix[3] <= 0)) return fail('Rotated or mirrored text requires original preservation')
  const characters = expected.flatMap((g, index) => [...normalize(g.unicode)].map(char => ({ char, index })))
  if (characters.map(c => c.char).join('') !== items.map(item => normalize(item.str)).join('')) return fail('PDF text order does not match painted glyphs')
  let cursor = 0
  const mapped = items.map(item => {
    let offset = 0
    return [...item.str].map(char => {
      const start = offset; offset += char.length
      const indexes = [...normalize(char)].map(() => characters[cursor++]?.index)
      return { start, end: offset, indexes }
    })
  })
  if (cursor !== characters.length || mapped.some(chars => chars.some(char => char.indexes.some(index => index === undefined)))) return fail('Unicode normalization cannot be mapped to source offsets')
  const rectangles = new Map<string, GlyphRect[]>(), owners = new Map<number,string>()
  for (const segment of segments) {
    const slices = segment.itemSlices?.length ? segment.itemSlices : (segment.itemIndexes ?? []).map(itemIndex => ({ itemIndex, start: 0, end: 1 }))
    const rects: GlyphRect[] = [], included = new Set<number>()
    for (const slice of slices) {
      const item = items[slice.itemIndex]
      if (!item || !Number.isFinite(slice.start) || !Number.isFinite(slice.end) || slice.start < 0 || slice.end > 1 || slice.end <= slice.start) return fail('Invalid source glyph slice')
      const leading = item.str.length - item.str.trimStart().length, length = item.str.trim().length
      const from = leading + Math.round(slice.start * length), to = leading + Math.round(slice.end * length)
      const sliceStart = rects.length
      for (const index of mapped[slice.itemIndex].filter(char => char.end > from && char.start < to).flatMap(char => char.indexes)) {
        if (included.has(index)) continue
        included.add(index)
        if (owners.has(index) && owners.get(index) !== segment.id) return fail('A source ligature crosses sentence boundaries')
        owners.set(index, segment.id)
        const glyph = painted[index], m = glyph.matrix, b = glyph.metrics
        const corners = [[-b.left,-b.ascent],[b.right,-b.ascent],[-b.left,b.descent],[b.right,b.descent]].map(([x,y]) => [glyph.x + m[0]*x + m[2]*y, glyph.y + m[1]*x + m[3]*y])
        const left = Math.min(...corners.map(p => p[0])), top = Math.min(...corners.map(p => p[1]))
        const width = Math.max(...corners.map(p => p[0])) - left, height = Math.max(...corners.map(p => p[1])) - top
        if (width > 0 && height > 0) rects.push({ left,top,width,height,fontSize: Math.abs(item.height) })
      }
      const ink = rects.splice(sliceStart)
      if (ink.length) {
        const left = Math.min(...ink.map(rect => rect.left)), top = Math.min(...ink.map(rect => rect.top))
        rects.push({ left, top, width: Math.max(...ink.map(rect => rect.left + rect.width)) - left,
          height: Math.max(...ink.map(rect => rect.top + rect.height)) - top, fontSize: Math.abs(item.height) })
      }
    }
    if (slices.length && !rects.length) return fail('Source sentence has no verified ink bounds')
    rectangles.set(segment.id, rects)
  }
  return { ok: true, rectangles }
}
