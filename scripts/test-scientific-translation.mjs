import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
import { prepareTranslationRequest, inspectTranslationRequest, reuseTranslations } from '../dist-electron/translationHarness.js'
const shared = await transformWithOxc(await fs.readFile('electron/scientificSource.ts','utf8'), 'electron/scientificSource.ts')
const sharedUrl = 'data:text/javascript;base64,' + Buffer.from(shared.code).toString('base64')
async function moduleFrom(file) {
  const source = (await fs.readFile(file,'utf8')).replaceAll("'../../electron/scientificSource'", JSON.stringify(sharedUrl))
  const { code } = await transformWithOxc(source,file)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { alignGlyphGeometry } = await moduleFrom('src/paper/glyphAlignment.ts')
const { scientificTranslationParts } = await moduleFrom('src/paper/scientificTranslationParts.ts')
const fixture = JSON.parse(await fs.readFile('scripts/fixtures/engineering-p4-inline-glyphs.json','utf8'))
const geometry = alignGlyphGeometry(fixture.expected,fixture.painted,fixture.items,fixture.segments)
assert(geometry.ok)
const input = fixture.segments.map(segment => ({ ...segment, scientificSpans: geometry.scientificSpans.get(segment.id) }))
const request = prepareTranslationRequest(input)
const output = request.items.map(item => {
  let text = item.source
  const spans = item.scientificSpans
  const replacements = request.protections.get(item.id)
  for (let i=spans.length-1;i>=0;i--) text = text.slice(0,spans[i].start) + replacements[i].token + text.slice(spans[i].end)
  return { id:item.id, translation:'회귀 검사: '+text }
})
const accepted = inspectTranslationRequest(JSON.stringify(output),request)
assert.equal(accepted.rejected.length,0)
for(const segment of input) {
  const translated = accepted.accepted.get(segment.id)
  assert(!translated.includes(request.sciencePrefix),'Protected transport markers must never become persisted prose')
  const parts = scientificTranslationParts(segment.source,translated,segment.scientificSpans)
  assert.equal(parts.map(part=>part.text).join(''),translated)
  assert.equal(parts.filter(part=>part.science).length,1,'Real verified notation survives translated placement')
  assert.equal(scientificTranslationParts(segment.source,translated,undefined).filter(part=>part.science).length,0,'Legacy plain strings do not invent subscript geometry')
}
const bad = structuredClone(output)
const token = request.protections.get(bad[0].id)[0].token
bad[0].translation = bad[0].translation.replace(token,token+token)
const partial = inspectTranslationRequest(JSON.stringify(bad),request)
assert.equal(partial.accepted.size,input.length-1,'A corrupt notation token must not discard the neighboring valid sentence')
assert.equal(partial.rejected.length,1)
const missing = structuredClone(output); missing[0].translation=missing[0].translation.replace(token,'0')
assert.equal(inspectTranslationRequest(JSON.stringify(missing),request).rejected.length,1)
const rho = input.find(item=>item.source.includes('ρ 0'))
assert.equal(reuseTranslations([rho],[{...rho,translation:rho.source.replace('ρ 0','0')}])[0].translation,undefined,'Legacy Greek-variable loss is invalidated when verified notation becomes available')
const m = input.find(item=>item.source.includes('m0'))
assert.equal(scientificTranslationParts(m.source,m.source.replace('m0','m01'),m.scientificSpans).filter(part=>part.science).length,0,'A different variable must not inherit a partial token crop')
const collision = prepareTranslationRequest([{id:'collision',source:'⟦PRISM_SCI_ is literal document data.'}])
assert.notEqual(collision.sciencePrefix,'⟦PRISM_SCI_')
console.log('Scientific translation: real PDF spans, transport restoration, partial rejection, cache validation and unambiguous inline crops passed.')
