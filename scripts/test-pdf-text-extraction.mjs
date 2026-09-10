import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const source = await fs.readFile('src/paper/textExtraction.ts', 'utf8')
const { code } = await transformWithOxc(source, 'src/paper/textExtraction.ts')
const { segmentsFromItems } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-text-items.json', 'utf8'))
const subheadingFixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-subheading.json', 'utf8'))
const page4 = segmentsFromItems(4, subheadingFixture.items)
assert.deepEqual(page4.map(({id,source})=>({id,source})),subheadingFixture.expectedSourceIdentity,'Every page4 source ID/text must retain cached translation and citation compatibility')
const explanation = page4.find(segment => segment.source.startsWith('In Formula (2)'))
const subsection = page4.find(segment => segment.source === '(4) Thermal conductivity tests.')
const thermalBody = page4.find(segment => segment.source.startsWith('The thermal conductivity of FC'))
assert(explanation && subsection && thermalBody)
assert.notEqual(explanation.blockId, subsection.blockId, 'Real numbered run-in title begins a new paragraph after the formula explanation')
assert.equal(subsection.blockId, thermalBody.blockId, 'Same-line run-in title and following body retain their source paragraph')
assert.equal(subsection.kind, 'text', 'Regular source font must not become a fabricated bold/display heading')
assert.equal(subsection.id, 'p4-s14-6lx5fl', 'Preserve existing source anchor identity for saved citations/translations')
assert.equal(subheadingFixture.fonts[subheadingFixture.items[subsection.itemIndexes[0]].fontName].name, 'MinionPro-Regular')

const density = segmentsFromItems(4, fixture.density)
assert(density.some(s => s.kind === 'text' && s.source.includes('dry density ρ 0 of FRFC')))
assert(!density.some(s => s.source.startsWith('0 of FRFC')))
const dimensions = segmentsFromItems(4, fixture.dimensions)
assert(dimensions.some(s => s.kind === 'text' && s.source.includes('300 mm × 300 mm × 30 mm')))
assert(!dimensions.some(s => s.kind === 'artifact'))
const caption = segmentsFromItems(4, fixture.caption)
assert.equal(caption.length, 1)
assert.equal(caption[0].kind, 'caption')
assert.equal(caption[0].source, 'Fig 2. Preparation process of FRFC.')
assert.deepEqual(segmentsFromItems(4, fixture.furniture), [])

// Preserve genuine section and paragraph boundaries while joining inline quantities.
const item = (str, y, hasEOL = true, height = 10) => ({str,y,width:120,height,transform:[height,0,0,height,100,y],hasEOL})
assert.deepEqual(segmentsFromItems(1,[item('Preprint',756),{...item('arXiv:2210.02747v2 [cs.LG] 8 Feb 2023',237),transform:[0,20,-20,0,32,237]}]),[],'Preprint headers and rotated arXiv stamps are page furniture, not translation prose')
const section = segmentsFromItems(1, [item('A preceding sentence.',700), item('2 Methods',674, true,12), item('We compared specimens.',655)])
assert(section.some(s=>s.kind==='heading' && s.source==='2 Methods'))
for (const label of ['Fig 3. Test setup.', 'Fig. 3. Test setup.', 'Figure 3. Test setup.', 'Table 3. Test setup.']) {
  assert.equal(segmentsFromItems(1,[item(label,700)])[0].kind,'caption')
}
for (const label of ['Fig 2) illustrates the differences.', '(1) SEM tests.', '(XLSX)', '[65].']) {
  const parsed = segmentsFromItems(1,[item(label,700)])
  assert(parsed.every(s=>!['caption','equation'].includes(s.kind)), label)
}
const inlineReference = segmentsFromItems(1,[item('See (',700,false),{...item('Fig 2) for the results.',700),transform:[10,0,0,10,126,700]}])
assert.equal(inlineReference.length,1)
assert.equal(inlineReference[0].kind,'text')
const inlineNumber = segmentsFromItems(1,[item('The trial used method',700,false),item('(4) Thermal conductivity tests.',700)])
assert.equal(new Set(inlineNumber.map(segment=>segment.blockId)).size,1,'Numbered text on the same baseline is not a new paragraph')
const damagedComparator = segmentsFromItems(11,[item('The proportion of S � 1.2 decreased for the reinforced specimens.',700)])
assert.equal(damagedComparator[0].kind,'artifact')
const mathFontEquation = segmentsFromItems(3,[{...item('x',700,false),fontName:'CMMI10'},{...item('i',700,false),fontName:'CMMI10',transform:[10,0,0,10,112,700]},{...item('=',700,false),fontName:'CMSY10',transform:[10,0,0,10,124,700]},{...item('z',700),fontName:'CMMI10',transform:[10,0,0,10,136,700]}])
assert.equal(mathFontEquation[0].kind,'equation','Math-font display fragments retain one formula boundary even when PDF glyph mapping loses operators')
const separatedDisplay = segmentsFromItems(4,[item('We define the objective,',636,false),{...item('',619),transform:[0,0,0,0,209,619]}, {...item('L(θ) = E ||v-u||²',619),transform:[10,0,0,10,209,619]},item('where samples are unbiased.',604)])
assert.deepEqual(separatedDisplay.map(segment=>segment.source),['We define the objective,','L(θ) = E ||v-u||²','where samples are unbiased.'],'Blank PDF line markers separate centered display math from surrounding prose')
const numberedDisplay = segmentsFromItems(4,[item('L(θ) = E ||v-u||²',619,false),item('(9) where samples are unbiased.',604)])
assert.deepEqual(numberedDisplay.map(segment=>segment.source),['L(θ) = E ||v-u||² (9)','where samples are unbiased.'],'A display equation number ends the formula before its explanatory prose')
for (const clause of ['where t ∼ U [0,1], x ∼ p_t(x).', 'Given initial conditions x(0) = x_0.', 'Let f(t) = ∫ g(s) ds.']) {
  assert.equal(segmentsFromItems(4,[item(clause,604)])[0].kind,'text',`Math-rich prose clause stays text: ${clause}`)
}
const positioned = (str,x,y,hasEOL=false,height=10,width=Math.max(5,str.length*5)) => ({str,width,height,transform:[height,0,0,height,x,y],hasEOL})
const fractionDisplay = segmentsFromItems(4,[
  positioned('This flow then provides a vector field that generates the conditional probability path:',108,149),
  positioned('',257,136,true,0,0), {...positioned('d',257,136,true),fontName:'CMMI10'}, {...positioned('dt',255,122),fontName:'CMMI10'},
  positioned('ψ(t,x) = u(t,ψ(t,x)|x1).',265,129), positioned('(13)',487,129,true),
  positioned('Reparameterizing the probability path in terms of the base sample.',108,111),
])
assert.deepEqual(fractionDisplay.map(segment=>segment.kind),['text','equation','text'],'A centered fraction between prose lines remains a separate display equation')
assert.match(fractionDisplay[1].source,/^d dt .*\(13\)$/)
assert.equal(segmentsFromItems(4,[positioned('That is to say, the preceding prose introduces the equation,',108,149),positioned('',257,136,true,0,0),positioned('x = y',257,136),positioned('(12)',487,136,true)])[0].kind,'text','Prose ending with a colon or comma before display math remains translatable prose')
const tallNormDisplay = segmentsFromItems(4,[
  positioned('L_CFM(θ) = E',201,91), positioned('',297,102,true,0,0), {...positioned('∥',297,102,true),fontName:'CMEX10'},
  positioned('∥v(ψ(x)) − d',297,91), positioned('d',362,98,true), positioned('dt',360,84),
  positioned('ψ(x)∥²',370,91), positioned('(14)',487,91,true), positioned('Since the map is invertible, the field has a closed form.',108,73),
])
assert.deepEqual(tallNormDisplay.map(segment=>segment.kind),['equation','text'],'Tall norm and fraction glyphs sharing one numbered display produce one equation anchor')
assert.match(tallNormDisplay[0].source,/\(14\)$/)
const matrixDisplay = segmentsFromItems(15,[
  positioned('Therefore, solve the ODE:',108,141), positioned('',240,124,true,0,0),
  {...positioned('d',240,124,true),fontName:'CMMI10'}, {...positioned('dt',238,110),fontName:'CMMI10'},
  {...positioned('[',250,131),fontName:'CMEX10'}, {...positioned('φ_t(x)',255,123),fontName:'CMMI10'},
  {...positioned('f(t)',258,112),fontName:'CMMI10'}, {...positioned(']',278,131),fontName:'CMEX10'},
  positioned('=',286,117), {...positioned('[',296,131),fontName:'CMEX10'},
  {...positioned('v_t(φ_t(x))',316,123),fontName:'CMMI10'}, positioned('−div(v_t(φ_t(x)))',302,112),
  {...positioned(']',370,131),fontName:'CMEX10'}, positioned('(28)',487,117,true),
  positioned('Given initial conditions',108,94,false,10,94), {...positioned('[',270,86),fontName:'CMEX10'},
  {...positioned('φ_0(x)',275,77),fontName:'CMMI10'}, {...positioned('f(0)',278,66),fontName:'CMMI10'},
  {...positioned(']',299,86),fontName:'CMEX10'}, positioned('=',307,72), {...positioned('[',317,86),fontName:'CMEX10'},
  {...positioned('x_0',323,77),fontName:'CMMI10'}, {...positioned('c',326,66),fontName:'CMMI10'},
  {...positioned(']',333,86),fontName:'CMEX10'}, positioned('(29)',487,72,true),
])
assert.deepEqual(matrixDisplay.map(segment => segment.kind),['text','equation','text','equation'],'Multi-row matrices remain one equation each and a prose lead-in stays translatable')
assert.match(matrixDisplay[1].source,/\(28\)$/); assert.match(matrixDisplay[3].source,/\(29\)$/)
const mixedSizes = [item('A smaller sidebar sentence contributes its font size.',720,true,8),item('Another smaller sidebar sentence contributes its font size.',706,true,8),item('The main paragraph ends with a continuation. While',680,true,10)]
assert.equal(segmentsFromItems(2,mixedSizes).find(s=>s.source==='While').kind,'text')
console.log('PDF extraction passed: real PLOS engineering dimensions/subscript/caption/footer regressions and section boundaries.')
