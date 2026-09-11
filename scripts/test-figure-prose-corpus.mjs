import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const load = async file => { const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file); return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')) }
const { figureOverlapsProse, joinBitmapRegions, joinVectorRegions } = await load('src/paper/figureGeometry.ts')
const { segmentsFromItems } = await load('src/paper/textExtraction.ts')
const { preservePdfTables } = await load('src/paper/tableRegions.ts')
const { preservePublicationFurniture } = await load('src/paper/publicationFurniture.ts')
const { textItemRect, segmentRects } = await load('src/paper/itemGeometry.ts')
const fixtures = JSON.parse(await fs.readFile('scripts/fixtures/figure-prose-corpus.json', 'utf8'))
function extract(f) {
  const rects = f.items.map(i => textItemRect([i.transform[0],-i.transform[1],i.transform[2],-i.transform[3],i.transform[4],f.height-i.transform[5]], i.width, 1, f.styles[i.fontName]?.ascent ?? .8, i.str))
  return preservePdfTables(preservePublicationFurniture(segmentsFromItems(f.page, f.items).map(s => ({...s, preciseRects: segmentRects(s, rects)})),new Map([[f.page, f]])))
}
for (const f of fixtures) {
  const segments = extract(f), evidence = segments.map(s => ({kind:s.kind, source:s.source, rects:s.preciseRects}))
  const candidates = [...joinBitmapRegions(f.bitmaps,1,f.width*f.height), ...joinVectorRegions(f.vectors,1,f.width*f.height)]
  const accepted = candidates.filter(r => !figureOverlapsProse(r,evidence))
  if (f.paper==='2103.02370'&&f.page===1) assert(segments.some(s=>s.kind==='heading'&&s.source==='1. Introduction'), 'A numbered introduction remains translatable, not an unsafe original paragraph')
  if (f.paper==='1706.03762'&&f.page===1) assert(segments.filter(s=>s.source.startsWith('Aidan')||s.source.startsWith('Gomez')).every(s=>s.kind==='artifact'), 'Starred author initials are metadata')
  if (f.paper==='2412.14974') assert(segments.some(s=>s.kind==='heading'&&s.source==='3.3. Geometric Details via Point Correspondence'), 'A final dot after a section number does not split off the heading')
  if (f.paper.includes('science') && f.page === 1) {
    assert(candidates.some(r=>r.width>500&&r.height>700), 'Actual publisher logo/frame reproduces the former page-sized figure')
    assert.equal(accepted.length,0,'The title, abstract and body must not be enclosed by a false figure')
    assert(segments.find(s=>s.source.startsWith('A programmable')).kind==='heading')
    assert(segments.find(s=>s.source.startsWith('CRISPR/Cas systems provide')).kind==='text')
    assert(segments.find(s=>s.source.startsWith('One-Sentence Summary')).kind==='heading')
    assert(segments.find(s=>s.source.startsWith('A two-RNA structure')).kind==='text')
    assert(segments.filter(s=>s.source.startsWith('Martin Jinek')||s.source.startsWith('Doudna')).every(s=>s.kind==='artifact'), 'Author names remain original')
    assert.equal(segments.find(s=>s.source.startsWith('1 Howard')).kind,'text', 'Affiliations are translated')
    const stamp = segments.find(s=>s.source==='HHMI Author Manuscript'), publication = segments.find(s=>s.source.startsWith('Published as:'))
    assert.notEqual(stamp.blockId,publication.blockId,'A vertical stamp cannot enlarge the horizontal publication crop into the title')
  } else if (['1706.03762','2412.14974'].includes(f.paper) && f.page >= 3) {
    assert(accepted.length>0,`${f.paper} p${f.page}: genuine architecture/attention/code diagrams must survive`)
    assert.equal(accepted.length,candidates.length,'Diagram labels must not veto a real figure')
  } else if (f.paper.includes('science') && f.page >= 9) {
    assert(accepted.length>0,'Real biological figures remain selectable')
  }
}
const paragraph = {kind:'text', source:'This is a normal research paragraph describing the measured effect of the treatment.',rects:[{left:100,top:100,width:400,height:12},{left:100,top:114,width:300,height:12}]}
assert(figureOverlapsProse({left:10,top:10,width:580,height:700},[paragraph]))
assert(figureOverlapsProse({left:100,top:100,width:200,height:30},[paragraph]),'Partial overlap also protects prose')
assert(!figureOverlapsProse({left:450,top:114,width:100,height:120},[paragraph]),'Empty space in a paragraph bounding box is not text')
assert(!figureOverlapsProse({left:10,top:10,width:580,height:700},[{...paragraph,kind:'caption'}]),'Captions can be included in tagged figures')
console.log('Real figure/prose corpus passed: publisher frame rejection, first-page metadata, abstract visibility, rotated axes, biological figures and code diagrams.')
const dateSegments = [{page:1,kind:'heading',source:'June 2025',blockId:'date'}, {page:1,kind:'text',source:'In June 2025, we measured the response.',blockId:'body'}]
const dated = preservePublicationFurniture(dateSegments,new Map([[1,{width:612,height:792}]]))
assert.equal(dated[0].kind,'artifact','Standalone publication dates are metadata')
assert.equal(dated[1].kind,'text','A date inside a real body sentence remains translatable')
