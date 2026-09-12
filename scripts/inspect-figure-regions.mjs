import fs from 'node:fs/promises'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { loadTs } from './load-ts.mjs'
const { segmentsFromItems } = await loadTs('src/paper/textExtraction.ts')
const { textItemRect, segmentRects } = await loadTs('src/paper/itemGeometry.ts')
const { joinBitmapRegions, joinVectorRegions, figureOverlapsProse } = await loadTs('src/paper/figureGeometry.ts')
const { pdfGraphicRects } = await loadTs('src/paper/pdfGraphics.ts')
const task = pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(process.argv[2])) }); const pdf = await task.promise
for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 5); pageNumber++) {
  const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 1 })
  const text = await page.getTextContent(), items = text.items.filter(item => 'str' in item)
  const segments = segmentsFromItems(pageNumber, items)
  const boxes = items.map(item => textItemRect(pdfjs.Util.transform(viewport.transform, item.transform), item.width, 1, .8, item.str))
  const evidence = segments.map(segment => ({ kind: segment.kind, source: segment.source, rects: segmentRects(segment, boxes) }))
  const operators = await page.getOperatorList(); const { images, vectors } = pdfGraphicRects(operators, viewport, pdfjs); const counts = {}
  const detected = [...joinBitmapRegions(images.filter(r => r.width > 72 && r.height > 55 && r.width*r.height > 7500 && r.width*r.height < viewport.width*viewport.height*.78),1,viewport.width*viewport.height),...joinVectorRegions(vectors,1,viewport.width*viewport.height)]
  console.log(JSON.stringify({ page: pageNumber, counts, images, vectors: vectors.length, detected: detected.map(rect => ({ rect, rejected: figureOverlapsProse(rect,evidence), blockers: evidence.filter(item => figureOverlapsProse(rect,[item])).map(item => ({source:item.source, rects:item.rects})) })), captions: segments.filter(s=>s.kind==='caption').map(s=>s.source) }))
}
await task.destroy()
