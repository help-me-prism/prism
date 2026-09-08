import assert from 'node:assert/strict'
import {
  buildOutline, mergeRefinement, outlineHash, parseEdgeResponse, parseRoleResponse, withoutCycles,
} from '../dist-electron/paperStructure.js'

// The structure map is only trustworthy if the model cannot put anything into it that is not in the paper.
// These cover the outline it is built from and every gate a model answer has to pass to change that outline.

const anchor = (id, type, page, source) => ({ id, type, page, source })
const anchors = [
  anchor('a0', 'heading', 1, 'Attention Is All You Need'),
  anchor('a1', 'heading', 1, 'Abstract'),
  anchor('a2', 'text', 1, 'The dominant sequence transduction models are based on complex recurrent networks.'),
  anchor('a3', 'heading', 2, '1 Introduction'),
  anchor('a4', 'text', 2, 'Recurrent models preclude parallelization within training examples, which becomes critical at longer lengths.'),
  anchor('a5', 'text', 2, 'short'),
  anchor('a6', 'heading', 2, '2 Background'),
  anchor('a7', 'text', 2, 'In these models the number of operations grows with the distance between positions.'),
  anchor('a8', 'heading', 3, '3 Model Architecture'),
  anchor('a9', 'text', 3, 'The Transformer follows this overall architecture using stacked self-attention and point-wise layers.'),
  anchor('a10', 'heading', 4, '3.1 Encoder and Decoder Stacks'),
  anchor('a11', 'text', 4, 'The encoder is composed of a stack of six identical layers with two sub-layers each.'),
  anchor('a12', 'heading', 6, '4 Why Self-Attention'),
  anchor('a13', 'heading', 7, '5 Training'),
  anchor('a14', 'heading', 8, '6 Results'),
  anchor('a15', 'heading', 10, '7 Conclusion'),
  anchor('a16', 'heading', 11, 'References'),
  anchor('a17', 'heading', 11, 'Acknowledgements'),
]

const outline = buildOutline('test.0001', anchors)
const ids = outline.nodes.map((node) => node.id)

// Only numbered section headings become nodes: a running title, the abstract and the back matter are not the argument.
assert.deepEqual(ids, ['s1', 's2', 's3', 's3.1', 's4', 's5', 's6', 's7'], `Unexpected outline: ${ids.join(', ')}`)
assert.equal(outline.source, 'outline')
assert(outline.nodes.every((node) => node.roleOrigin === 'outline'), 'The outline claimed a role came from a model.')

// Roles come from the titles, and a subsection with nothing distinctive in its title is a part of its parent.
const roleOf = (id) => outline.nodes.find((node) => node.id === id).role
assert.equal(roleOf('s1'), 'problem')
assert.equal(roleOf('s2'), 'background')
assert.equal(roleOf('s3'), 'method')
assert.equal(roleOf('s3.1'), 'component', 'A subsection of the method was not treated as one of its parts.')
assert.equal(roleOf('s4'), 'rationale')
assert.equal(roleOf('s5'), 'experiment')
assert.equal(roleOf('s6'), 'result')
assert.equal(roleOf('s7'), 'limit')

// Every node can take the reader back to the page it came from.
const introduction = outline.nodes.find((node) => node.id === 's1')
assert.equal(introduction.anchorId, 'a3')
assert.equal(introduction.page, 2)
assert.deepEqual(introduction.evidence, ['a4'], 'Only the prose under the heading is evidence, and only if it is long enough to say something.')

// The paper's own order is the only structure the outline asserts: a chain of top-level sections, parts hanging off them.
const chain = outline.edges.filter((edge) => edge.type === 'then').map((edge) => `${edge.from}->${edge.to}`)
assert.deepEqual(chain, ['s1->s2', 's2->s3', 's3->s4', 's4->s5', 's5->s6', 's6->s7'], `Unexpected order: ${chain.join(' ')}`)
assert.deepEqual(outline.edges.filter((edge) => edge.type === 'part').map((edge) => `${edge.from}->${edge.to}`), ['s3->s3.1'])
assert(outline.edges.every((edge) => edge.origin === 'outline'), 'An outline edge claimed to come from a model.')

const allowed = new Set(ids)

// A model answer is read for what it is allowed to say and nothing else.
const roles = parseRoleResponse(`Sure, here you go:
\`\`\`json
{"sections":[
  {"id":"s1","role":"problem","summary":"  순차 계산이   병렬화를 막는다  "},
  {"id":"s3","role":"method","summary":"순환 없이 어텐션만 쓴다"},
  {"id":"s1","role":"result","summary":"같은 구간을 두 번"},
  {"id":"s99","role":"method","summary":"논문에 없는 구간"},
  {"id":"s2","role":"nonsense","summary":"역할이 아닌 역할"},
  {"id":"s5","role":"experiment"}
]}
\`\`\``, allowed)
assert.deepEqual(roles.map((patch) => patch.id), ['s1', 's3', 's5'], `Unknown ids, unknown roles or repeats survived: ${JSON.stringify(roles)}`)
assert.equal(roles[0].summary, '순차 계산이 병렬화를 막는다', 'A summary was not tidied before being stored.')
assert.equal(roles[0].role, 'problem', 'A repeated section overwrote the first answer for it.')
assert.equal(roles[2].summary, undefined, 'A missing summary became something other than nothing.')
assert.throws(() => parseRoleResponse('죄송하지만 도와드릴 수 없습니다.', allowed), /JSON/, 'A reply with no JSON in it was accepted.')

// Relations may only join two sections that exist, may not repeat the order already drawn, and are capped.
const edges = parseEdgeResponse(JSON.stringify({
  relations: [
    { from: 's4', to: 's6', type: 'supports', why: '복잡도 비교가 결과를 뒷받침' },
    { from: 's3', to: 's3', type: 'needs', why: '자기 자신' },
    { from: 's1', to: 's2', type: 'needs', why: '이미 그려진 순서' },
    { from: 's3', to: 's99', type: 'needs', why: '없는 구간' },
    { from: 's2', to: 's3', type: 'part', why: '모델이 쓸 수 없는 종류' },
    { from: 's2', to: 's4', type: 'needs', why: '배경을 전제로 한다' },
    { from: 's4', to: 's6', type: 'branches', why: '같은 쌍을 다시' },
  ],
}), allowed, outline.edges)
assert.deepEqual(edges.map((edge) => `${edge.from}-${edge.type}->${edge.to}`), ['s4-supports->s6', 's2-needs->s4'],
  `The edge gate let something through: ${JSON.stringify(edges)}`)
assert(edges.every((edge) => edge.origin === 'model'), 'A model edge was not marked as one.')

const many = parseEdgeResponse(JSON.stringify({
  relations: ids.flatMap((from) => ids.map((to) => ({ from, to, type: 'supports' }))).filter((edge) => edge.from !== edge.to),
}), allowed, [])
assert.equal(many.length, 8, `The number of relations one run may add is capped: got ${many.length}`)

// A relation that closes a loop cannot be drawn as a flow, so it is refused rather than placed misleadingly.
const backwards = [{ id: 'm1', from: 's6', to: 's1', type: 'supports', origin: 'model' }]
const forwards = [{ id: 'm2', from: 's2', to: 's5', type: 'needs', origin: 'model' }]
const gate = withoutCycles(outline.edges, [...forwards, ...backwards])
assert.deepEqual(gate.kept.map((edge) => edge.id), ['m2'])
assert.deepEqual(gate.dropped.map((edge) => edge.id), ['m1'], 'A cycle was allowed into the map.')

// Putting a stored run back on top of the outline may colour it in, and may not change its shape.
const stored = {
  ...outline, source: 'model',
  nodes: [
    { ...outline.nodes[0], role: 'background', roleOrigin: 'model', summary: '모델이 붙인 요약' },
    { id: 's99', role: 'result', label: '없는 구간', section: '99', level: 1, page: 1, anchorId: 'zz', evidence: [], roleOrigin: 'model' },
  ],
  edges: [
    { id: 'm2', from: 's2', to: 's5', type: 'needs', origin: 'model' },
    { id: 'm3', from: 's2', to: 's99', type: 'needs', origin: 'model' },
    { id: 'm4', from: 's1', to: 's2', type: 'supports', origin: 'model' },
  ],
  notes: ['한 번 실패했습니다'],
  model: { provider: 'codex', model: 'gpt-5', ranAt: '2026-09-08T00:00:00.000Z' },
}
const merged = mergeRefinement(outline, stored)
assert.deepEqual(merged.nodes.map((node) => node.id), ids, 'A stored run changed which sections exist.')
assert.equal(merged.nodes[0].role, 'background')
assert.equal(merged.nodes[0].summary, '모델이 붙인 요약')
assert.equal(merged.nodes[0].anchorId, 'a3', 'A stored run moved where a section points in the PDF.')
assert.equal(merged.nodes[1].roleOrigin, 'outline', 'A section the run said nothing about was marked as the model\'s.')
assert.deepEqual(merged.edges.filter((edge) => edge.origin === 'model').map((edge) => edge.id), ['m2'],
  'An edge to a section that does not exist, or a repeat of the paper\'s own order, was merged in.')
assert.equal(merged.model?.model, 'gpt-5')

// A re-analysed paper produces a different outline hash, so an older run is not silently reused.
assert.notEqual(outlineHash(outline.nodes), outlineHash(outline.nodes.slice(1)))
assert.equal(outlineHash(outline.nodes), outline.sourceHash)

console.log('paper structure: outline, both model gates, and the merge hold.')

// The whole pass, end to end, with the model replaced by a script: what it writes, and what it refuses to write.
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readPaperStructure, refinePaperStructure } from '../dist-electron/paperStructure.js'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'prism-structure-'))
try {
  await fsp.mkdir(path.join(root, 'papers', 'test.0001'), { recursive: true })
  await fsp.writeFile(path.join(root, 'papers', 'test.0001', 'anchors.json'),
    JSON.stringify({ version: 1, paperId: 'test.0001', anchors }), 'utf8')

  const asked = []
  const answers = [
    JSON.stringify({ sections: [
      { id: 's1', role: 'problem', summary: '순차 계산이 병렬화를 막는다' },
      { id: 's2', role: 'background', summary: '거리가 멀수록 연산이 늘어난다' },
      { id: 's3', role: 'method', summary: '순환 없이 어텐션만 쓴다' },
      { id: 's3.1', role: 'component', summary: '인코더와 디코더를 여섯 층씩 쌓는다' },
      { id: 's4', role: 'rationale', summary: '레이어당 복잡도와 경로 길이를 비교한다' },
      { id: 's5', role: 'experiment', summary: 'WMT 2014로 학습한다' },
      { id: 's6', role: 'result', summary: 'BLEU가 기존 최고를 넘는다' },
      { id: 's7', role: 'limit', summary: '다른 양식으로의 확장을 남긴다' },
    ] }),
    JSON.stringify({ relations: [
      { from: 's4', to: 's6', type: 'supports', why: '복잡도 논증이 결과를 뒷받침' },
      { from: 's6', to: 's1', type: 'supports', why: '거꾸로 도는 연결' },
    ] }),
  ]
  const run = await refinePaperStructure(root, 'test.0001', 'Test Paper', 'codex', 'gpt-5', async (prompt) => {
    asked.push(prompt)
    return answers[asked.length - 1] ?? '{}'
  })

  // Roles are asked for with the paper's own sentences in front of the model, and relations with the ids alone.
  assert.equal(asked.length, 2, 'The pass should ask two questions, not one.')
  assert(asked[0].includes('Recurrent models preclude parallelization'), 'The role question did not quote the paper.')
  assert(!asked[1].includes('Recurrent models preclude parallelization'), 'The relation question should carry only the sections.')
  assert(asked[0].includes('s3.1') && asked[0].includes('only these ids'), 'The model was not held to the ids that exist.')

  assert.equal(run.summaries, 8)
  assert.equal(run.edgesAdded, 1)
  assert.equal(run.dropped, 1, 'The backwards relation should have been refused.')
  assert(run.notes.some((note) => note.includes('순환')), `The run did not say why it dropped one: ${JSON.stringify(run.notes)}`)

  // Reading it back gives the outline with the run merged on top, and says a model touched it.
  const stored = await readPaperStructure(root, 'test.0001')
  assert.equal(stored.source, 'model')
  assert.equal(stored.model?.model, 'gpt-5')
  assert.deepEqual(stored.nodes.map((node) => node.id), ids, 'The stored run changed which sections exist.')
  assert.equal(stored.nodes.find((node) => node.id === 's3').summary, '순환 없이 어텐션만 쓴다')
  assert.equal(stored.edges.filter((edge) => edge.origin === 'model').length, 1)

  // A model that answers with nothing usable leaves the reader with the outline, and is told why.
  await refinePaperStructure(root, 'test.0001', 'Test Paper', 'codex', 'gpt-5', async () => '무슨 말인지 모르겠습니다.')
  const refused = await readPaperStructure(root, 'test.0001')
  assert.equal(refused.source, 'outline', 'A failed run was still presented as a model reading.')
  assert(refused.notes.some((note) => note.includes('절반')), `The refusal was not explained: ${JSON.stringify(refused.notes)}`)
  assert.equal(refused.nodes.find((node) => node.id === 's3').summary, undefined, 'A refused run left its summaries behind.')

  console.log('paper structure: the model pass writes only what survives the gates, and refuses the rest.')
} finally {
  await fsp.rm(root, { recursive: true, force: true })
}
