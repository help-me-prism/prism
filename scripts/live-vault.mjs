import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Builds the vault a real researcher would start this session with: their three papers, no notes, no chat.
 * Usage: node scripts/live-vault.mjs <source-library>
 * The source library is only read from.
 */
const sourceLibrary = path.resolve(process.argv[2] ?? '')
const root = path.join(process.cwd(), 'tmp', 'live')
const libraryPath = path.join(root, 'library')
const profile = path.join(root, 'profile')

await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(path.join(libraryPath, '.prism', 'anchors'), { recursive: true })
await fs.mkdir(profile, { recursive: true })

const library = JSON.parse(await fs.readFile(path.join(sourceLibrary, '.prism', 'library.json'), 'utf8'))
const papers = []
for (const record of library.slice(0, 3)) {
  const from = path.join(sourceLibrary, 'papers', record.arxivId)
  const to = path.join(libraryPath, 'papers', record.arxivId)
  await fs.mkdir(to, { recursive: true })
  for (const file of ['original.pdf', 'metadata.json', 'anchors.json', 'latex-structure.json', 'translation.ko.json']) {
    await fs.copyFile(path.join(from, file), path.join(to, file)).catch(() => undefined)
  }
  await fs.copyFile(path.join(sourceLibrary, '.prism', 'anchors', `${record.arxivId}.json`), path.join(libraryPath, '.prism', 'anchors', `${record.arxivId}.json`)).catch(() => undefined)
  const metadata = JSON.parse(await fs.readFile(path.join(to, 'metadata.json'), 'utf8'))
  const abstract = (metadata.summary ?? record.summary ?? '').replace(/\n/g, '\n> ')
  // Exactly what a fresh download leaves behind: front matter, the abstract, and two empty headings.
  await fs.writeFile(path.join(to, `${record.arxivId}.md`), `---\ntype: paper\nprism_id: "paper-${record.arxivId}"\narxiv_id: "${record.arxivId}"\ntitle: ${JSON.stringify(record.title)}\nstatus: inbox\nreading_status: to_read\nimportance: medium\nconfidence: medium\ncreated_by: user\ntags: [paper, arxiv]\n---\n\n# ${record.title}\n\n> [!abstract]- Abstract\n> ${abstract}\n\n## 내 생각\n\n## 메모\n`, 'utf8')
  papers.push({ ...record, pdfPath: path.join(to, 'original.pdf'), notePath: path.join(to, `${record.arxivId}.md`), translationPath: path.join(to, 'translation.ko.json') })
}
await fs.writeFile(path.join(libraryPath, '.prism', 'library.json'), JSON.stringify(papers, null, 2), 'utf8')
await fs.writeFile(path.join(profile, 'sessions.json'), '[]', 'utf8')
console.log(`clean vault: ${papers.length} papers, 0 notes beyond the papers, 0 concepts, 0 chats`)
console.log(`library: ${libraryPath}`)
