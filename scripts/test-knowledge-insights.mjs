import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listKnowledgeGraphInsights } from '../dist-electron/knowledgeGraph.js'
import { clusterKnowledgeGraph } from '../dist-electron/knowledgeClusters.js'
import { invalidateKnowledgeCache } from '../dist-electron/knowledge.js'

/**
 * Both derived measures are judged against a vault whose answers are planted: three subjects that share no
 * distinctive vocabulary, wired into three groups, with the same generated boilerplate in every note. A
 * suggestion list and a set of coloured blobs both look convincing when they are wrong, so neither is trusted
 * here — the test asks whether they recover what was planted. See shared/contracts/knowledge-graph.md.
 */
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-insights-test-'))

// The same generated section every note carries. If it counts toward similarity, every pair scores alike.
const boilerplate = `\n## 이 노트의 관계\n\n<!-- prism:auto relations -->\n관련된 노트를 여기에 자동으로 적습니다. 이 문단은 프리즘이 쓴 것이며 사용자가 쓴 문장이 아닙니다.\n<!-- /prism:auto relations -->\n`

const subjects = {
  optics: ['렌즈', '굴절률', '초점거리', '수차', '조리개', '파장', '회절'],
  baking: ['반죽', '발효', '글루텐', '오븐', '수분율', '이스트', '굽기'],
  routing: ['라우팅', '패킷', '홉', '지연', '대역폭', '혼잡', '경로'],
}
const nodes = []
const write = async (relative, content) => {
  const target = path.join(root, ...relative.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}
const note = (id, type, title, body) =>
  `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\nimportance: medium\nconfidence: medium\n---\n\n# ${title}\n\n${body}\n${boilerplate}`

let counter = 0
for (const [subject, vocabulary] of Object.entries(subjects)) {
  for (let index = 0; index < 6; index += 1) {
    counter += 1
    const id = `concept-${subject}${index}${'x'.repeat(6)}`
    const shuffled = vocabulary.map((word, position) => vocabulary[(position + index) % vocabulary.length])
    const body = `${shuffled[0]}과 ${shuffled[1]}의 관계를 정리한다. ${shuffled[2]}이 커지면 ${shuffled[3]}이 따라 변하고, ${shuffled[4]}은 그대로다. ${shuffled[5]}을 바꿔 가며 ${shuffled[6]}을 관찰했다.`
    nodes.push({ id, subject, index })
    await write(`Concepts/${subject}-${index}.md`, note(id, 'concept', `${subject} ${index}`, body))
  }
}
// Two notes with nothing but the generated section: never a suggestion, whatever the vault looks like.
await write('Concepts/empty-one.md', note('concept-emptyoneaaa', 'concept', '빈 노트 하나', ''))
await write('Concepts/empty-two.md', note('concept-emptytwoaaa', 'concept', '빈 노트 둘', ''))

// Wire each subject into a ring, and join the three rings with one bridge each: three groups, planted.
let relation = 0
const link = async (a, b, type = 'uses') => {
  relation += 1
  const id = `relation-${String(relation).padStart(8, '0')}-aaaa-bbbb-cccc-${String(relation).padStart(6, '0')}`
  await write(`.prism/relations/${id}.json`, JSON.stringify({ id, sourceId: a, targetId: b, type, creator: 'user', reviewStatus: 'approved', origin: 'manual', createdAt: '2026-09-08T00:00:00.000Z' }))
}
const bySubject = (subject) => nodes.filter((node) => node.subject === subject)
for (const subject of Object.keys(subjects)) {
  const members = bySubject(subject)
  for (let index = 0; index < members.length; index += 1) {
    await link(members[index].id, members[(index + 1) % members.length].id)
    await link(members[index].id, members[(index + 2) % members.length].id)
  }
}
await link(bySubject('optics')[0].id, bySubject('baking')[0].id)
await link(bySubject('baking')[0].id, bySubject('routing')[0].id)

try {
  invalidateKnowledgeCache()
  const { similar, clusters } = await listKnowledgeGraphInsights(root)
  const subjectOf = new Map(nodes.map((node) => [node.id, node.subject]))

  // ---------- similarity ----------
  assert.ok(similar.pairs.length >= 3, `no suggestions at all: ${JSON.stringify(similar)}`)
  const wrong = similar.pairs.filter((pair) => subjectOf.get(pair.a) !== subjectOf.get(pair.b))
  assert.equal(wrong.length, 0, `suggested a pair from two different subjects: ${JSON.stringify(wrong.slice(0, 3))}`)
  const empty = similar.pairs.filter((pair) => pair.a.startsWith('concept-empty') || pair.b.startsWith('concept-empty'))
  assert.equal(empty.length, 0, 'a note holding only the generated section was suggested')
  assert.ok(similar.thin.includes('concept-emptyoneaaa'), 'the empty note should be reported as too thin to compare')
  assert.ok(similar.pairs.every((pair) => pair.shared.length > 0), 'every suggestion has to name why it was made')
  const shared = similar.pairs[0].shared
  assert.ok(shared.some((term) => Object.values(subjects).flat().some((word) => word.startsWith(term) || term.startsWith(word))),
    `the reason should be the subject's own words, not boilerplate: ${JSON.stringify(shared)}`)
  assert.ok(similar.threshold > 0, 'the threshold is reported so a list can say why it is this long')

  // ---------- clusters ----------
  assert.ok(clusters.clear, `the planted split should be clear, Q=${clusters.modularity}`)
  assert.ok(clusters.modularity > 0.3, `modularity too low: ${clusters.modularity}`)
  assert.equal(clusters.clusters.length, 3, `expected three groups, got ${clusters.clusters.map((group) => group.members.length).join('+')}`)
  for (const group of clusters.clusters) {
    const subjectsInGroup = new Set(group.members.map((id) => subjectOf.get(id)))
    assert.equal(subjectsInGroup.size, 1, `a group mixed subjects: ${[...subjectsInGroup].join(', ')}`)
    assert.equal(group.members.length, 6, 'each planted subject is one whole group')
    assert.ok(group.name && group.members.includes(group.nameId), 'a group is named after one of its own members')
  }
  assert.ok(clusters.loose.includes('concept-emptyoneaaa'), 'an unconnected note belongs to no group')

  // ---------- the same vault twice is the same answer ----------
  const graph = await (await import('../dist-electron/knowledgeGraph.js')).listKnowledgeGraph(root)
  const edges = graph.edges.filter((edge) => edge.reviewStatus === 'approved' && edge.type !== 'mentions')
  const first = clusterKnowledgeGraph(graph.nodes, edges)
  const second = clusterKnowledgeGraph([...graph.nodes].reverse(), [...edges].reverse())
  const key = (report) => report.clusters.map((group) => [...group.members].sort().join(',')).sort().join(' | ')
  assert.equal(key(first), key(second), 'the same vault in a different order gave different groups')

  // ---------- one more note must not reshuffle the vault ----------
  await write('Concepts/optics-6.md', note('concept-opticsSixxx', 'concept', 'optics 6', '렌즈와 조리개를 바꿔 가며 회절 무늬를 관찰했다. 파장이 길수록 무늬 간격이 넓어진다.'))
  await link('concept-opticsSixxx', bySubject('optics')[1].id)
  await link('concept-opticsSixxx', bySubject('optics')[2].id)
  invalidateKnowledgeCache()
  const after = await listKnowledgeGraphInsights(root)
  const before = new Map()
  for (const group of clusters.clusters) for (const member of group.members) before.set(member, group.members.length)
  let kept = 0; let total = 0
  for (const group of after.clusters.clusters) {
    const subjectsInGroup = new Set(group.members.map((id) => subjectOf.get(id) ?? 'optics'))
    for (const member of group.members) {
      if (!before.has(member)) continue
      total += 1
      if (subjectsInGroup.size === 1) kept += 1
    }
  }
  assert.ok(kept / total >= 0.9, `adding one note moved ${(100 - kept / total * 100).toFixed(0)}% of the vault into other groups`)

  console.log(`Knowledge insights passed: three planted subjects recovered as three groups (Q=${clusters.modularity}), `
    + `${similar.pairs.length} suggestions all within a subject and each naming its shared words, `
    + `boilerplate-only notes excluded, order-independent and stable when a note is added.`)
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
