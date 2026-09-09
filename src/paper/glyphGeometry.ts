import { OPS } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import { alignGlyphGeometry, type GlyphGeometryResult, type GlyphSegment, type GlyphTextItem, type PaintedGlyph, type SourceGlyph } from './glyphAlignment'

/** Capture PDF.js's actual text paints without allocating another page-sized bitmap. */
export async function captureGlyphGeometry(page: PDFPageProxy, items: GlyphTextItem[], segments: GlyphSegment[]): Promise<GlyphGeometryResult> {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) return { ok:false, reason:'Canvas text metrics unavailable' }
  const originalFillText = context.fillText
  try {
    const operators = await page.getOperatorList(), expected: SourceGlyph[] = [], fonts: string[] = [], usedFonts = new Set<string>()
    let font = ''
    for (let i=0; i<operators.fnArray.length; i++) {
      const operation = operators.fnArray[i], args = operators.argsArray[i]
      if (operation === OPS.save) fonts.push(font)
      else if (operation === OPS.restore) font = fonts.pop() ?? ''
      else if (operation === OPS.setFont) { font = args[0]; usedFonts.add(font) }
      else if (operation === OPS.setTextRenderingMode && args[0] !== 0) return {ok:false,reason:'Non-fill text requires original source preservation'}
      else if (operation === OPS.showText) {
        for (const glyph of args[0]) {
          if (typeof glyph === 'number') continue
          if (glyph.accent || typeof glyph.unicode !== 'string' || typeof glyph.fontChar !== 'string') return {ok:false,reason:'Unsupported composite glyph paint'}
          expected.push({unicode:glyph.unicode,fontChar:glyph.fontChar,fontRef:font})
        }
      }
    }
    for (const name of usedFonts) {
      const pdfFont = page.commonObjs.get(name)
      if (!pdfFont || pdfFont.isType3Font || pdfFont.vertical || pdfFont.remeasure || pdfFont.missingFile || pdfFont.disableFontFace || pdfFont.isInvalidPDFjsFont) return {ok:false,reason:'Font requires original source preservation'}
    }
    const painted: PaintedGlyph[] = []
    context.fillText = function(text: string, x: number, y: number, maxWidth?: number) {
      const m = this.getTransform(), metrics = this.measureText(text)
      painted.push({char:text,x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,font:this.font,matrix:[m.a,m.b,m.c,m.d,m.e,m.f],metrics:{left:metrics.actualBoundingBoxLeft,right:metrics.actualBoundingBoxRight,ascent:metrics.actualBoundingBoxAscent,descent:metrics.actualBoundingBoxDescent}})
      if (maxWidth === undefined) originalFillText.call(this,text,x,y)
      else originalFillText.call(this,text,x,y,maxWidth)
    }
    await page.render({canvas,canvasContext:context,viewport:page.getViewport({scale:1})}).promise
    return alignGlyphGeometry(expected,painted,items,segments)
  } catch {
    return {ok:false,reason:'Precise PDF glyph capture unavailable'}
  } finally {
    context.fillText = originalFillText
    canvas.width = canvas.height = 1
  }
}
