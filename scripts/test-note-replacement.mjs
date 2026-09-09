import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { saveNoteSnapshot } from '../dist-electron/notes.js'
import { replaceNotePreservingHistory, listNoteHistory, readNoteHistory, recoverNoteReplacements, listPendingNoteRecoveries, recoverPendingNote } from '../dist-electron/noteReplacement.js'
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-note-replacement-'))
const hash = value => createHash('sha256').update(value).digest('hex')
const note = path.join(root, 'Research.md')
const reset = () => fs.writeFile(note, 'before')
try {
  await reset()
  let result = await replaceNotePreservingHistory(note, 'prism draft', hash('before'))
  assert.equal(result.saved, true)
  assert.equal(await fs.readFile(note, 'utf8'), 'prism draft')
  assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'displaced.md'), 'utf8'), 'before')
  await fs.writeFile(note, 'external after publish')
  assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'draft.md'), 'utf8'), 'prism draft', 'Recovery draft must have its own inode')
  const history = await listNoteHistory(note)
  assert.equal(history.length, 2, 'Unchanged before/displaced contents should appear once while all files remain on disk')
  assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'before.md'), 'utf8'), 'before')
  assert.equal(await readNoteHistory(note, history.find(item => item.kind === 'draft').id), 'prism draft')
  await assert.rejects(readNoteHistory(note, '../draft'))
  await assert.rejects(readNoteHistory(path.join(root, 'Other.md'), history[0].id))
  const linkedId = '00000000-0000-0000-0000-000000000001'
  await fs.symlink(result.recoveryDirectory, path.join(root, '.prism-note-history', linkedId), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(readNoteHistory(note, `${linkedId}-draft`))
  assert.equal((await listNoteHistory(note)).length, 2, 'Linked history directories must not expose recovery entries')
  await fs.unlink(note)
  await recoverNoteReplacements(root)
  assert.equal(await fs.stat(note).then(() => true, () => false), false, 'A completed save must not resurrect a deleted note')
  await reset()
  result = await replaceNotePreservingHistory(note, 'prism draft', hash('before'), { onPhase: async phase => { if (phase === 'beforeCapture') await fs.writeFile(note, 'external before capture') } })
  assert.equal(result.saved, false)
  assert.equal(await fs.readFile(note, 'utf8'), 'external before capture')
  assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'before.md'), 'utf8'), 'before')
  await reset()
  result = await replaceNotePreservingHistory(note, 'active draft', hash('before'), { onPhase: async phase => {
    if (phase === 'afterCapture') {
      await recoverNoteReplacements(root)
      assert.equal(await fs.stat(note).then(() => true, () => false), false, 'Scanner must skip an active transaction')
    }
  } })
  // Reconstruct a crash-after-capture journal and exercise startup recovery without a live transaction.
  await fs.unlink(note)
  const crashedDirectory = path.join(root, '.prism-note-history', randomUUID())
  await fs.cp(result.recoveryDirectory, crashedDirectory, { recursive: true })
  const infoPath = path.join(crashedDirectory, 'metadata.json')
  const info = JSON.parse(await fs.readFile(infoPath, 'utf8'))
  await fs.writeFile(infoPath, JSON.stringify({ ...info, state: 'pending' }))
  await recoverNoteReplacements(root)
  assert.equal(await fs.readFile(note, 'utf8'), 'before')
  const competingDirectory = path.join(root, '.prism-note-history', randomUUID())
  await fs.cp(crashedDirectory, competingDirectory, { recursive: true })
  await fs.writeFile(path.join(competingDirectory, 'metadata.json'), JSON.stringify({ ...info, state: 'pending' }))
  await fs.writeFile(note, 'existing external version')
  await recoverNoteReplacements(root)
  assert.equal(await fs.readFile(note, 'utf8'), 'existing external version')
  await reset()
  result = await replaceNotePreservingHistory(note, 'prism draft', hash('before'), { onPhase: async phase => { if (phase === 'beforePublish') await fs.writeFile(note, 'competing new target', { flag: 'wx' }) } })
  assert.equal(result.saved, false); assert.equal(result.conflict.content, 'competing new target')
  for (const kind of ['draft', 'before']) {
    const pendingId = randomUUID(); const pendingDir = path.join(root, '.prism-note-history', pendingId)
    await fs.cp(result.recoveryDirectory, pendingDir, { recursive: true })
    const pendingInfo = JSON.parse(await fs.readFile(path.join(pendingDir, 'metadata.json'), 'utf8'))
    await fs.writeFile(path.join(pendingDir, 'metadata.json'), JSON.stringify({ ...pendingInfo, state: 'publishing' }))
    await assert.rejects(recoverPendingNote(root, pendingId, kind), /이미 노트 파일/)
    assert.equal(await fs.readFile(note, 'utf8'), 'competing new target')
    await fs.unlink(note)
    assert((await listPendingNoteRecoveries(root)).some(item => item.id === pendingId && item.kinds.includes(kind)), 'Publishing-gap note must be discoverable without an indexed note ID')
    await recoverNoteReplacements(root)
    assert.equal(await fs.stat(note).then(() => true, () => false), false, 'Publishing gap must require explicit recovery')
    assert.equal((await recoverPendingNote(root, pendingId, kind)).notePath, note)
    assert.equal(await fs.readFile(note, 'utf8'), kind === 'draft' ? 'prism draft' : 'before')
    await fs.writeFile(note, 'competing new target')
    assert.equal(await fs.readFile(path.join(pendingDir, `${kind}.md`), 'utf8'), kind === 'draft' ? 'prism draft' : 'before', 'Editing restored note must not mutate history')
    assert(!(await listPendingNoteRecoveries(root)).some(item => item.id === pendingId))
  }
  await assert.rejects(recoverPendingNote(root, '../outside', 'draft'))
  await assert.rejects(recoverPendingNote(root, randomUUID(), '../outside'))
  const unsafeId = randomUUID(); const unsafeDir = path.join(root, '.prism-note-history', unsafeId)
  await fs.mkdir(unsafeDir)
  await fs.writeFile(path.join(unsafeDir, 'metadata.json'), JSON.stringify({ version: 1, state: 'publishing', noteFile: '../escaped.md', createdAt: new Date().toISOString() }))
  await fs.writeFile(path.join(unsafeDir, 'draft.md'), 'must stay inside history')
  assert(!(await listPendingNoteRecoveries(root)).some(item => item.id === unsafeId))
  await assert.rejects(recoverPendingNote(root, unsafeId, 'draft'))
  await reset()
  let recovery
  await assert.rejects(replaceNotePreservingHistory(note, 'prism draft', hash('before'), { link: async () => { throw Object.assign(new Error('No hard links'), { code: 'ENOTSUP' }) } }), error => { recovery = error.recoveryDirectory; return Boolean(recovery) && error.message.includes('원본 파일을 교체하지 않았습니다') && error.message.includes('초안') })
  assert.equal(await fs.readFile(note, 'utf8'), 'before', 'Unsupported hard links must be detected before removing the live note')
  assert.equal(await fs.stat(path.join(recovery, 'displaced.md')).then(() => true, () => false), false, 'Preflight failure must not capture the live file')
  assert.equal(await fs.readFile(path.join(recovery, 'draft.md'), 'utf8'), 'prism draft')
  await reset()
  const outside = path.join(root, 'outside-secret.md'); await fs.writeFile(outside, 'outside must never become conflict content')
  let symlinkSupported = true
  const probe = path.join(root, 'symlink-probe')
  try { await fs.symlink(outside, probe); await fs.unlink(probe) } catch (error) { if (error.code === 'EPERM') symlinkSupported = false; else throw error }
  if (symlinkSupported) {
    await assert.rejects(replaceNotePreservingHistory(note, 'safe draft', hash('before'), { onPhase: async phase => {
      if (phase === 'beforeCapture') { await fs.unlink(note); await fs.symlink(outside, note) }
    } }), error => Boolean(error.recoveryDirectory) && !error.message.includes('outside must never'))
    assert.equal(await fs.readFile(outside, 'utf8'), 'outside must never become conflict content')
    await fs.unlink(note).catch(() => undefined)
  } else console.log('File-symlink race skipped: this Windows account lacks symlink privilege; junction rejection remains covered.')
  // Separate process opens the original inode, then writes after Prism has published its new file.
  await reset()
  const child = spawn(process.execPath, ['-e', `const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'r+');process.send('ready');process.on('message',()=>{fs.ftruncateSync(fd,0);fs.writeSync(fd,'late external fd');fs.closeSync(fd);process.send('written');process.disconnect()})`, note], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true })
  const message = () => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject) })
  await message()
  try {
    result = await replaceNotePreservingHistory(note, 'prism draft', hash('before'), { onPhase: async phase => { if (phase === 'afterPublish') { const done = message(); child.send('write'); await done } } })
    assert.equal(await fs.readFile(note, 'utf8'), 'prism draft')
    assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'displaced.md'), 'utf8'), 'late external fd')
    assert.equal(await fs.readFile(path.join(result.recoveryDirectory, 'before.md'), 'utf8'), 'before')
  } finally { if (child.exitCode === null) child.kill() }
  await fs.writeFile(note, 'already changed externally')
  const rejected = await saveNoteSnapshot(note, { content: 'submitted conflicting draft', expectedRevision: hash('old editor snapshot') })
  assert.equal(rejected.saved, false)
  assert.equal(await fs.readFile(note, 'utf8'), 'already changed externally')
  const submittedHistory = await listNoteHistory(note)
  assert((await Promise.all(submittedHistory.filter(item => item.kind === 'draft').map(item => readNoteHistory(note, item.id)))).includes('submitted conflicting draft'), 'An early revision conflict must retain the submitted draft beyond the renderer lifetime')
  console.log('note-replacement: independent snapshots, capture/publish races, unsupported links, conflicting drafts and cross-process late-fd recovery passed')
} finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
