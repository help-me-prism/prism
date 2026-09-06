import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listKnowledgeGraph } from '../dist-electron/knowledgeGraph.js'

// The whole-vault graph, on plain Markdown in a throwaway vault. See shared/contracts/knowledge-graph.md.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-graph-test-'))
function note(id, type, title, body) { return `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\nimportance: medium\nconfidence: medium\n---\n\n# ${title}\n\n${body}\n` }
async function write(relative, content) {
  const target = path.join(root, ...relative.split('/'))
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}
const relation = (id, sourceId, targetId, extra) => write(`.prism/relations/relation-${id}.json`, JSON.stringify({ id: `relation-${id}`, sourceId, targetId, creator: 'user', reviewStatus: 'approved', createdAt: '2026-09-07T00:00:00.000Z', ...extra }))

try {
  await write('Papers/Paper Alpha.md', note('paper-aaaaaaaa', 'paper', 'Paper Alpha', 'Uses [[Score matching]] throughout.'))
  await write('Papers/Paper Beta.md', note('paper-bbbbbbbb', 'paper', 'Paper Beta', 'No links here.'))
  await write('Concepts/Score matching.md', note('concept-cccccccc', 'concept', 'Score matching', 'A definition.'))
  await write('Claims/Disputed.md', note('claim-dddddddd', 'claim', 'Disputed', 'Noise prediction wins.'))
  await write('Questions/Open.md', note('question-eeeeeeee', 'question', 'Open', 'Why?'))

  await relation('11111111111111111111', 'paper-aaaaaaaa', 'claim-dddddddd', { type: 'supports' })
  await relation('22222222222222222222', 'paper-bbbbbbbb', 'claim-dddddddd', { type: 'contradicts' })
  await relation('33333333333333333333', 'paper-aaaaaaaa', 'question-eeeeeeee', { type: 'raises', creator: 'ai', reviewStatus: 'pending' })
  await relation('44444444444444444444', 'paper-bbbbbbbb', 'question-eeeeeeee', { type: 'answers', creator: 'ai', reviewStatus: 'rejected' })

  const graph = await listKnowledgeGraph(root)
  assert.equal(graph.nodes.length, 5, 'every note is a node')
  assert.deepEqual([...new Set(graph.nodes.map((node) => node.nodeType))].sort(), ['claim', 'concept', 'paper', 'question'])

  const byId = new Map(graph.edges.map((edge) => [edge.id, edge]))
  assert.equal(byId.get('relation-11111111111111111111').type, 'supports')
  assert.equal(byId.get('relation-22222222222222222222').type, 'contradicts')

  // Every layer is carried, including the ones the default view hides: the view decides, not the transport.
  const pending = byId.get('relation-33333333333333333333')
  assert.equal(pending.reviewStatus, 'pending')
  assert.equal(pending.creator, 'ai')
  const rejected = byId.get('relation-44444444444444444444')
  assert.equal(rejected.reviewStatus, 'rejected', 'a rejected relation is still reported, and the view drops it')

  // A [[link]] written in Obsidian has no sidecar record, and is still an edge.
  const linkEdge = graph.edges.find((edge) => edge.origin === 'link')
  assert.ok(linkEdge, 'the wikilink became an edge')
  assert.equal(linkEdge.sourceId, 'paper-aaaaaaaa')
  assert.equal(linkEdge.targetId, 'concept-cccccccc')
  assert.equal(linkEdge.type, 'link')

  // A typed relation for the same pair wins: the link must not be added twice.
  await relation('55555555555555555555', 'paper-aaaaaaaa', 'concept-cccccccc', { type: 'uses' })
  const second = await listKnowledgeGraph(root)
  const pair = second.edges.filter((edge) => edge.sourceId === 'paper-aaaaaaaa' && edge.targetId === 'concept-cccccccc')
  assert.equal(pair.length, 1, 'one edge for one pair')
  assert.equal(pair[0].type, 'uses')

  // A relation pointing at a note that is not in the vault is not an edge.
  await relation('66666666666666666666', 'paper-aaaaaaaa', 'concept-99999999', { type: 'uses' })
  const third = await listKnowledgeGraph(root)
  assert.ok(!third.edges.some((edge) => edge.targetId === 'concept-99999999'), 'a dangling relation is dropped')

  console.log('knowledge graph OK')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
