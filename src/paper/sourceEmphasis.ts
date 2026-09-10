/** Source PDF metadata only: never infer emphasis from the sentence's wording. */
type SourceFont = { name?: string; bold?: boolean; black?: boolean }
type FontPage = {
  getOperatorList: () => Promise<unknown>
  commonObjs: { get: (name: string) => unknown }
}
type TextItem = { str: string; fontName?: string }
type SegmentItems = { itemIndexes?: number[]; itemSlices?: Array<{ itemIndex: number; start: number; end: number }> }
export type SourceFontWeights = Record<string, 400 | 700 | undefined>

export function sourceFontWeight(font: SourceFont | undefined): 400 | 700 | undefined {
  if (!font) return undefined
  if (font.bold === true || font.black === true) return 700
  // PDF.js text-item IDs (g_d0_f1) and CSS fallback families carry no weight.
  // Resolve the real embedded/BaseFont name, stripping the PDF subset prefix.
  const name = font.name?.replace(/^[A-Z]{6}\+/, '') ?? ''
  if (/(?:^|[-_,\s])(?:bold|semibold|demibold|demi|black|extrabold)(?:italic|oblique)?(?:$|[-_,\s])/i.test(name)) return 700
  if (font.bold === false || /(?:^|[-_,\s])(?:regular|roman|book|normal)(?:$|[-_,\s])/i.test(name)) return 400
  // Explicit standard PDF fonts whose unsuffixed name defines regular weight.
  if (/^(?:Helvetica|Courier)(?:-Oblique)?$|^Times-(?:Roman|Italic)$/i.test(name)) return 400
  return undefined
}

/** getTextContent().styles exposes fallback families, not the embedded weight.
 * Operator loading resolves font objects in PDF.js; failure leaves weight unset.
 */
export async function collectSourceFontWeights(page: FontPage, items: TextItem[]): Promise<SourceFontWeights> {
  const weights: SourceFontWeights = {}
  try { await page.getOperatorList() } catch { return weights }
  for (const name of new Set(items.map(item => item.fontName).filter((name): name is string => Boolean(name)))) {
    try { weights[name] = sourceFontWeight(page.commonObjs.get(name) as SourceFont | undefined) } catch { /* Unsupported font: retain normal rendering. */ }
  }
  return weights
}

/** A whole translated sentence may preserve dominant source emphasis. This does
 * not claim cross-language word alignment; minority inline bold stays unmarked.
 * Unknown font characters count against the threshold rather than invent bold.
 */
export function dominantSourceWeight(segment: SegmentItems, items: TextItem[], weights: SourceFontWeights): 400 | 700 | undefined {
  const slices = segment.itemSlices ?? (segment.itemIndexes ?? []).map(itemIndex => ({ itemIndex, start: 0, end: 1 }))
  let total = 0; let bold = 0; let normal = 0
  for (const slice of slices) {
    const item = items[slice.itemIndex]
    if (!item || !Number.isFinite(slice.start) || !Number.isFinite(slice.end)) continue
    const str = item.str.trim()
    const start = Math.max(0, Math.min(1, slice.start)); const end = Math.max(start, Math.min(1, slice.end))
    const chars = str.slice(Math.round(start * str.length), Math.round(end * str.length)).replace(/\s/g, '').length
    total += chars
    const weight = item.fontName ? weights[item.fontName] : undefined
    if (weight === 700) bold += chars
    if (weight === 400) normal += chars
  }
  if (!total) return undefined
  if (bold / total >= .6) return 700
  if (normal / total >= .6) return 400
  return undefined
}
