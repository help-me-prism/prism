// Persistent, isolated manual-review session; never modifies the source vault.
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const root = await fs.mkdtemp(path.resolve('tmp/prism-product-ui-persona-'))
const vault = path.join(root, 'vault')
const profile = path.join(root, 'profile')
await fs.mkdir(path.join(vault, '.prism'), { recursive: true })
await fs.mkdir(profile)
const source = path.resolve('tmp/live/library')
const records = JSON.parse(await fs.readFile(path.join(source, '.prism/library.json'), 'utf8'))
const papers = []
for (const record of records) {
  const target = path.join(vault, 'papers', record.arxivId)
  await fs.cp(path.join(source, 'papers', record.arxivId), target, { recursive: true })
  papers.push({ ...record, pdfPath: path.join(target, 'original.pdf'), notePath: path.join(target, `${record.arxivId}.md`), translationPath: path.join(target, 'translation.ko.json'), sourcePath: undefined, externalAssets: false })
}
await fs.writeFile(path.join(vault, '.prism/library.json'), JSON.stringify(papers))
await fs.writeFile(path.join(profile, 'settings.json'), JSON.stringify({ libraryPath: vault, autoTranslate: false, translationProvider: 'codex', translationModel: 'gpt-5.6-luna' }))
await fs.writeFile(path.join(root, 'selection.txt'), papers[0].pdfPath)
const child = spawn(require('electron'), ['--remote-debugging-port=9351', `--user-data-dir=${profile}`, 'scripts/product-test-host.cjs'], { windowsHide: false, stdio: 'ignore', detached: true, env: { ...process.env, PRISM_PRODUCT_TEST_ROOT: root, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1280x900' } })
child.unref()
await fs.writeFile(path.resolve('tmp/persona-session.json'), JSON.stringify({ root, vault, profile, pid: child.pid, port: 9351 }, null, 2))
console.log(JSON.stringify({ root, pid: child.pid, port: 9351 }))
