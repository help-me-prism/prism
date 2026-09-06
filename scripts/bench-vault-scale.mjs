import { promises as fsp } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

/**
 * The vault the researcher actually has is seven notes, where everything is fast and nothing is proved. This
 * builds a library of a realistic future size and measures the two shapes side by side: the walk-per-lookup
 * the code used to do, and the single pass it does now. Run it as
 *
 *   node scripts/bench-vault-scale.mjs [nodeCount]
 *
 * It writes only to a temporary folder and never touches a real library.
 */
const { listKnowledgeBacklinks, invalidateKnowledgeCache, listKnowledgeNodes, readVaultSnapshot } = await import('../dist-electron/knowledge.js')
const { refreshVaultDigests } = await import('../dist-electron/paperDigest.js')

let reads = 0
const realReadFile = fsp.readFile
fsp.readFile = (...args) => { reads += 1; return realReadFile(...args) }
const counted = async (label, run) => {
  reads = 0
  const started = performance.now()
  const value = await run()
  return { label, ms: performance.now() - started, reads, value }
}
const row = (result) => `  ${result.label.padEnd(34)} ${`${result.ms.toFixed(0)}ms`.padStart(9)} ${`${result.reads} reads`.padStart(14)}`

const total = Number(process.argv[2] ?? 120)
const papers = Math.max(1, Math.round(total * 0.35))
const concepts = Math.max(1, Math.round(total * 0.35))
const claims = Math.max(1, Math.round(total * 0.2))
const questions = Math.max(1, total - papers - concepts - claims)

const libraryPath = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-bench-'))
const frontmatter = (type, id, title, extra = '') => `---\ntype: ${type}\nprism_id: ${JSON.stringify(id)}\ntitle: ${JSON.stringify(title)}\nstatus: developing\n${extra}---\n\n# ${title}\n\n`
const linkTo = (index) => `[[Concepts/개념 ${index % concepts}]]`

for (const folder of ['Papers', 'Concepts', 'Claims', 'Questions', 'Templates', 'papers']) await fs.mkdir(path.join(libraryPath, folder), { recursive: true })
for (let index = 0; index < papers; index += 1) {
  const arxivId = `24${String(index).padStart(2, '0')}.${String(10000 + index)}`
  await fs.mkdir(path.join(libraryPath, 'papers', arxivId), { recursive: true })
  const body = `> [!abstract]- Abstract\n> We introduce a method that improves sampling. Existing approaches are expensive. Results outperform prior work.\n\n## Notes\n\n논문 ${index}에서 ${linkTo(index)}와 ${linkTo(index + 1)}를 다룬다.\n\n## 내 생각\n\n`
  await fs.writeFile(path.join(libraryPath, 'papers', arxivId, `${arxivId}.md`), frontmatter('paper', `paper-${arxivId}`, `논문 ${index}`, `arxiv_id: ${JSON.stringify(arxivId)}\nreading_status: to_read\n`) + body)
}
for (let index = 0; index < concepts; index += 1) await fs.writeFile(path.join(libraryPath, 'Concepts', `개념 ${index}.md`), frontmatter('concept', `concept-${String(index).padStart(8, '0')}`, `개념 ${index}`) + `${linkTo(index + 2)}와 관련이 있다.\n\n## 내 생각\n\n`)
for (let index = 0; index < claims; index += 1) await fs.writeFile(path.join(libraryPath, 'Claims', `주장 ${index}.md`), frontmatter('claim', `claim-${String(index).padStart(8, '0')}`, `주장 ${index}`, 'claim_origin: paper\n') + `${linkTo(index)}에 기대는 주장.\n\n## 내 생각\n\n`)
for (let index = 0; index < questions; index += 1) await fs.writeFile(path.join(libraryPath, 'Questions', `질문 ${index}.md`), frontmatter('question', `question-${String(index).padStart(8, '0')}`, `질문 ${index}`) + `${linkTo(index + 3)}은 왜 그런가?\n\n## 내 생각\n\n`)

// The shape the code had before: finding one note by id meant parsing every note, so every lookup was a walk.
async function walkEveryFile() {
  const found = []
  const collect = async (directory, paperFolder) => {
    let entries = []
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return [] }
    for (const entry of entries) if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const content = await fs.readFile(path.join(directory, entry.name), 'utf8')
      const id = content.match(/^prism_id:\s*"?([^"\n]+)"?$/m)?.[1]
      if (id) found.push({ id, content, relativePath: path.relative(libraryPath, path.join(directory, entry.name)).split(path.sep).join('/') })
    }
    return entries
  }
  for (const folder of ['Papers', 'Concepts', 'Claims', 'Insights', 'Questions', 'Projects']) await collect(path.join(libraryPath, folder))
  for (const folder of await collect(path.join(libraryPath, 'papers'))) if (folder.isDirectory()) await collect(path.join(libraryPath, 'papers', folder.name), folder.name)
  return found
}
async function oldBacklinks(targetId) {
  const nodes = await walkEveryFile()
  const target = nodes.find((node) => node.id === targetId)
  if (!target) return []
  const route = target.relativePath.replace(/\.md$/i, '').toLowerCase()
  const base = route.split('/').at(-1)
  const backlinks = []
  for (const node of nodes) {
    if (node.id === targetId) continue
    const fresh = (await walkEveryFile()).find((item) => item.id === node.id)
    if (!fresh) continue
    const hit = [...fresh.content.matchAll(/\[\[([^\]\n]+)\]\]/g)].some((match) => {
      const value = match[1].split('|', 1)[0].replace(/\.md$/i, '').toLowerCase()
      return value === route || (!value.includes('/') && value === base)
    })
    if (hit) backlinks.push(node.id)
  }
  return backlinks
}

console.log(`\nVault: ${total} nodes (papers ${papers} · concepts ${concepts} · claims ${claims} · questions ${questions})\n`)

console.log('Reading the vault')
invalidateKnowledgeCache()
console.log(row(await counted('readVaultSnapshot (cold)', () => readVaultSnapshot(libraryPath))))
console.log(row(await counted('readVaultSnapshot (warm)', () => readVaultSnapshot(libraryPath))))
console.log(row(await counted('listKnowledgeNodes (warm)', () => listKnowledgeNodes(libraryPath))))

const sample = (await listKnowledgeNodes(libraryPath)).slice(0, 5)

// Faster is only interesting if it is also the same answer, so the two implementations are compared first.
const withBaseline = process.env.PRISM_BENCH_BASELINE !== 'off'
for (const node of withBaseline ? sample : []) {
  const now = (await listKnowledgeBacklinks(libraryPath, node.id)).map((item) => item.nodeId).sort()
  const before = (await oldBacklinks(node.id)).sort()
  if (now.join('|') !== before.join('|')) throw new Error(`backlinks disagree for ${node.id}\n  now:    ${now.join(', ')}\n  before: ${before.join(', ')}`)
}
if (withBaseline) console.log(`Backlink parity: ${sample.length} notes match the walk-per-lookup answer exactly.`)

console.log('\nBacklinks for 5 notes')
console.log(row(await counted('now  · listKnowledgeBacklinks', async () => { for (const node of sample) await listKnowledgeBacklinks(libraryPath, node.id) })))
if (withBaseline) console.log(row(await counted('before · walk per lookup', async () => { for (const node of sample) await oldBacklinks(node.id) })))

console.log('\nOpening the Notes window (digest sweep over every note)')
invalidateKnowledgeCache()
const sweep = await counted('now  · refreshVaultDigests', () => refreshVaultDigests(libraryPath, []))
console.log(row(sweep))
console.log(`  ${''.padEnd(34)} ${''.padStart(9)} ${`${sweep.value.updated.length}/${sweep.value.scanned} written`.padStart(14)}`)
if (withBaseline) {
  const perNote = await counted('before · one lookup per note', async () => { for (const node of sample) await oldBacklinks(node.id) })
  console.log(`  before · projected for all ${String(total).padEnd(6)} ${`${(perNote.ms / sample.length * total).toFixed(0)}ms`.padStart(9)} ${`${Math.round(perNote.reads / sample.length * total)} reads`.padStart(14)}`)
}

await fs.rm(libraryPath, { recursive: true, force: true })
console.log('')
