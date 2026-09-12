import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import { loadTs as load } from './load-ts.mjs'

const{segmentsFromItems}=await load('src/paper/textExtraction.ts');const{preservePdfTables}=await load('src/paper/tableRegions.ts');const{preservePublicationFurniture}=await load('src/paper/publicationFurniture.ts');const{segmentRects}=await load('src/paper/itemGeometry.ts');const{latexSentenceSource}=await load('src/paper/latexProse.ts');const{paddedExcerptBounds}=await load('src/paper/excerptBounds.ts');
const fixtures=JSON.parse(await fs.readFile('scripts/fixtures/translation-review3.json','utf8'));
const extract=(paper,page)=>{const f=fixtures.find(f=>f.paper===paper&&f.page===page);return preservePdfTables(preservePublicationFurniture(segmentsFromItems(page,f.items,f.weights).map(s=>({...s,preciseRects:segmentRects(s,f.rects)})),new Map([[page,f]])))};
const s=extract('2606.02682',4),algorithm=s.filter(s=>s.blockId.startsWith('pdf-listing-')&&s.source.match(/^Algorithm 1|^[456]:/));
assert.equal(algorithm.length,4);assert.equal(new Set(algorithm.map(s=>s.blockId)).size,1);assert(algorithm.every(s=>s.kind==='table'));assert(algorithm.at(-1).source.endsWith('14: legend()'));
assert.equal(s.find(s=>s.source.startsWith('In this code')).kind,'text');assert.equal(s.find(s=>s.source.startsWith('Dense(')).kind,'table');
const heading=extract('2606.02682',3).find(s=>s.source.startsWith('2.1'));
assert.equal(heading.kind,'heading');assert(heading.source.endsWith('c √ t'));
const crispr=extract('doi_10.1126_science.1225829',14);assert.equal(crispr.find(s=>s.kind==='caption').source,'Fig. 5. Cas9 can be programmed using a single engineered RNA molecule combining tracrRNA and crRNA features.');assert.equal(crispr.find(s=>s.source.startsWith('(A)')).kind,'text');
for(const paper of ['2606.02682','doi_10.1126_science.1225829'])assert(extract(paper,1).filter(s=>/^\d.*(?:University|Institute)/.test(s.source)).every(s=>s.kind==='text'));
assert(!extract('doi_10.1126_science.1225829',1).some(s=>s.source==='3 Max F.'));
const source='In addition, the parameter $\\kappa$ changes in $[0, \\infty).$ Leveraging the powerful pattern recognition capabilities of neural networks, this study predicts $\\kappa$ accurately.';
assert.equal(latexSentenceSource(source,'In addition, the parameter κ changes in [0 , ∞ ) .'),'In addition, the parameter $\\kappa$ changes in $[0, \\infty).$');
assert.equal(latexSentenceSource('According to [longBibKey] the inverse map $g_t(z)$ is given by:', 'According to [13] the inverse map g t ( z ) is given by:'),'According to [13] the inverse map $g_t(z)$ is given by:');
assert.equal(latexSentenceSource('We plot $x$ with plt.figure() and Dense(2).','6: z values ← linspace( − 2 , 2 , 100)'),undefined);
assert.equal(latexSentenceSource('A completely different sentence describes $x$.','We compute the inverse map at every point.'),undefined);
const crop=paddedExcerptBounds({left:10,top:10,width:90,height:20},[{left:10,top:31,width:90,height:10}]);assert(crop.top+crop.height<31);assert(crop.top<10);
console.log('Reported PDFs: caption/body split, affiliations, all algorithm rows, network code, radical heading, math sentence/citation fidelity and bounded crop padding passed.');
