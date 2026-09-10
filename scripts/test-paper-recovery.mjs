import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('electron/paperRecovery.ts', 'utf8'), 'electron/paperRecovery.ts')
const { planPaperRecovery, updateRecoveredPdfLink } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prism-recovery-')))
try {
  const root = path.join(temp, 'moved'); await fs.mkdir(root)
  const bytes = Buffer.from('%PDF-1.7\nrecovery fixture')
  const hash = createHash('sha256').update(bytes).digest('hex')
  const id = `local-${hash.slice(0, 24)}`
  const old = path.join(temp, 'old', id)
  const target = path.join(root, id); await fs.mkdir(target)
  const oldPdf = path.join(old, 'original.pdf'), newPdf = path.join(target, 'original.pdf')
  const oldLine = `pdf: ${JSON.stringify(pathToFileURL(oldPdf).href)}`
  const newLine = `pdf: ${JSON.stringify(pathToFileURL(newPdf).href)}`
  assert.equal(updateRecoveredPdfLink(`---\nmy_${oldLine}\n${oldLine}\n---`, oldPdf, newPdf), `---\nmy_${oldLine}\n${newLine}\n---`)
  for (const newline of ['\n', '\r\n']) {
    const note = ['---', 'title: "My note"', oldLine, '---', '', '# Own prose', oldLine].join(newline)
    assert.equal(updateRecoveredPdfLink(note, oldPdf, newPdf), ['---', 'title: "My note"', newLine, '---', '', '# Own prose', oldLine].join(newline))
  }
  for (const note of [
    `# Body\n${oldLine}`,
    `---\nmy_${oldLine}\n---\n${oldLine}`,
    `---\npdf: "user-customized"\n---\n${oldLine}`,
    `---\n${oldLine} # own comment\n---`,
    `---\n${oldLine}\n${oldLine}\n---`,
    `---\n${oldLine}\n"pdf": "other"\n---`,
  ]) assert.equal(updateRecoveredPdfLink(note, oldPdf, newPdf), undefined)
  await fs.writeFile(path.join(target, 'original.pdf'), bytes)
  const record = { arxivId: id, externalAssets: true, pdfPath: path.join(old, 'original.pdf'), translationPath: path.join(old, 'translation.ko.json'), sourcePath: path.join(old, 'source.tar.gz'), notePath: path.join(temp, 'vault', 'note.md') }
  const original = structuredClone(record)
  let plan = await planPaperRecovery([record], root)
  assert.equal(plan.restored, 1); assert.equal(plan.skipped, 0)
  assert.equal(plan.records[0].pdfPath, path.join(target, 'original.pdf'))
  assert.equal(plan.records[0].sourcePath, path.join(target, 'source.tar.gz'))
  assert.equal(plan.records[0].notePath, record.notePath)
  assert.deepEqual(record, original)
  assert.equal((await fs.readdir(target)).length, 1, 'Planning must not create missing assets')
  const full = { ...record, arxivId: 'hep-th/1234', pdfSha256: hash, translationPath: path.join(temp, 'separate.json') }
  await fs.mkdir(path.join(root, 'hep-th_1234')); await fs.writeFile(path.join(root, 'hep-th_1234', 'original.pdf'), bytes)
  plan = await planPaperRecovery([full], root)
  assert.equal(plan.restored, 1); assert.equal(plan.records[0].translationPath, full.translationPath)
  for (const patch of [{ pdfSha256: 'f'.repeat(64) }, { pdfSha256: 'bad' }, { arxivId: 'unknown' }]) {
    plan = await planPaperRecovery([{ ...record, ...patch }], root); assert.equal(plan.skipped, 1); assert.equal(plan.restored, 0)
  }
  plan = await planPaperRecovery([{ ...record, externalAssets: false }], root); assert.equal(plan.restored, 0); assert.equal(plan.skipped, 0)
  await fs.mkdir(old, { recursive: true }); await fs.writeFile(record.pdfPath, 'different existing PDF')
  plan = await planPaperRecovery([record], root); assert.equal(plan.records[0].pdfPath, record.pdfPath); assert.equal(plan.skipped, 0)
  await fs.unlink(record.pdfPath)
  await fs.rename(target, path.join(temp, 'outside'))
  await fs.symlink(path.join(temp, 'outside'), target, process.platform === 'win32' ? 'junction' : 'dir')
  plan = await planPaperRecovery([record], root); assert.equal(plan.failures[0].reason, 'outside-root')
  await assert.rejects(planPaperRecovery([record], path.join(temp, 'missing-root')), { code: 'ENOENT' })
  await assert.rejects(planPaperRecovery([{ ...record, pdfPath: 'invalid\0path.pdf' }], root), { code: 'ERR_INVALID_ARG_VALUE' }, 'Non-missing IO errors must not be treated as recoverable missing PDFs')
  console.log('paper-recovery: immutable verified relocation, existing paths, fingerprint priority, path mapping and symlink containment passed')
} finally { await fs.rm(temp, { recursive: true, force: true }) }
