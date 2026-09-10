import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile, replaceFileWithRetry } from './atomicFile.js'
const activeTransactions = new Set<string>()
const completedTransactions = new Set<string>()
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i
type Manifest = { version: number; noteFile: string; createdAt: string; state?: 'pending' | 'publishing' | 'complete' }
async function manifest(directory: string): Promise<Manifest> {
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('잘못된 복구 폴더입니다.')
  const file = path.join(directory, 'metadata.json')
  const metadataStat = await fs.lstat(file)
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) throw new Error('복구 메타데이터 링크는 허용하지 않습니다.')
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as Manifest
  if (value.version !== 1 || typeof value.noteFile !== 'string' || path.basename(value.noteFile) !== value.noteFile || /[\\/:]/.test(value.noteFile) || !/\.md$/i.test(value.noteFile) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('잘못된 복구 메타데이터입니다.')
  return value
}
async function historyRoot(notePath: string) {
  const root = path.join(path.dirname(path.resolve(notePath)), '.prism-note-history')
  try { if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('복구 폴더 링크는 허용하지 않습니다.') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  return root
}
async function safeHistoryFile(directory: string, kind: string) {
  const file = path.join(directory, `${kind}.md`)
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(await fs.realpath(file)) !== await fs.realpath(directory)) throw new Error('잘못된 복구 파일입니다.')
  return { file, size: stat.size }
}
export async function listNoteHistory(notePath: string) {
  const root = await historyRoot(notePath)
  let names: string[]
  try { names = await fs.readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const result: Array<{ id: string; createdAt: number; kind: 'before' | 'draft' | 'displaced'; size: number }> = []
  for (const name of names.filter(name => uuidPattern.test(name))) {
    const directory = path.join(root, name)
    try {
      const info = await manifest(directory)
      if (info.noteFile !== path.basename(notePath)) continue
      let sameBefore = false
      try {
        const before = await safeHistoryFile(directory, 'before'); const displaced = await safeHistoryFile(directory, 'displaced')
        sameBefore = before.size === displaced.size && (await fs.readFile(before.file)).equals(await fs.readFile(displaced.file))
      } catch { /* a missing or unsafe displaced file cannot hide the independent before snapshot */ }
      for (const kind of ['before', 'draft', 'displaced'] as const) {
        if (kind === 'before' && sameBefore) continue
        try { const file = await safeHistoryFile(directory, kind); result.push({ id: `${name}-${kind}`, createdAt: Date.parse(info.createdAt), kind, size: file.size }) } catch { /* missing or unsafe entry is never offered */ }
      }
    } catch { /* incomplete or unsafe transaction is never offered */ }
  }
  return result.sort((a, b) => b.createdAt - a.createdAt)
}
export async function readNoteHistory(notePath: string, id: string) {
  const match = /^([a-f\d-]{36})-(before|draft|displaced)$/i.exec(id)
  if (!match || !uuidPattern.test(match[1])) throw new Error('잘못된 복구 항목입니다.')
  const directory = path.join(await historyRoot(notePath), match[1])
  if ((await manifest(directory)).noteFile !== path.basename(notePath)) throw new Error('다른 노트의 복구 항목입니다.')
  return fs.readFile((await safeHistoryFile(directory, match[2])).file, 'utf8')
}
export async function listPendingNoteRecoveries(parentDir: string) {
  const root = await historyRoot(path.join(parentDir, 'placeholder.md'))
  let names: string[]
  try { names = await fs.readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  const entries: Array<{ id: string; noteFile: string; createdAt: number; kinds: Array<'draft' | 'before' | 'displaced'> }> = []
  for (const id of names.filter(name => uuidPattern.test(name))) {
    const directory = path.join(root, id)
    if (activeTransactions.has(directory)) continue
    try {
      const info = await manifest(directory)
      if (info.state !== 'pending' && info.state !== 'publishing') continue
      try { await fs.lstat(path.join(path.resolve(parentDir), info.noteFile)); continue }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const kinds: Array<'draft' | 'before' | 'displaced'> = []
      for (const kind of ['draft', 'before', 'displaced'] as const) { try { await safeHistoryFile(directory, kind); kinds.push(kind) } catch { /* unsafe or incomplete choice is not offered */ } }
      if (kinds.length) entries.push({ id, noteFile: info.noteFile, createdAt: Date.parse(info.createdAt), kinds })
    } catch { /* malformed transaction cannot be used as an arbitrary file target */ }
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt)
}
/** Explicit recovery of a missing note; the chosen history inode is never linked into the live note. */
export async function recoverPendingNote(parentDir: string, id: string, kind: 'draft' | 'before' | 'displaced') {
  if (!uuidPattern.test(id) || !['draft', 'before', 'displaced'].includes(kind)) throw new Error('잘못된 복구 항목입니다.')
  const entry = (await listPendingNoteRecoveries(parentDir)).find(item => item.id === id && item.kinds.includes(kind))
  if (!entry) throw new Error('복구 대상이 없거나 이미 노트 파일이 존재합니다.')
  const directory = path.join(await historyRoot(path.join(parentDir, 'placeholder.md')), id)
  const source = await safeHistoryFile(directory, kind)
  const chosen = await fs.readFile(source.file, 'utf8')
  const stage = path.join(directory, `recover-${randomUUID()}.tmp`)
  const target = path.join(path.resolve(parentDir), entry.noteFile)
  activeTransactions.add(directory)
  try {
    await durableExclusive(stage, chosen)
    await fs.link(stage, target)
    const info = await manifest(directory)
    await atomicWriteFile(path.join(directory, 'metadata.json'), JSON.stringify({ ...info, state: 'complete' }))
    completedTransactions.add(directory)
    return { notePath: target }
  } finally {
    await fs.unlink(stage).catch(() => undefined)
    activeTransactions.delete(directory)
  }
}
export async function recoverNoteReplacements(parentDir: string) {
  const root = await historyRoot(path.join(parentDir, 'placeholder.md'))
  let names: string[]
  try { names = await fs.readdir(root) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  for (const name of names.filter(name => uuidPattern.test(name))) {
    const directory = path.join(root, name)
    if (activeTransactions.has(directory) || completedTransactions.has(directory)) continue
    try {
      const info = await manifest(directory)
      if (info.state === 'complete') { completedTransactions.add(directory); continue }
      if (info.state !== 'pending') continue
      const displaced = await safeHistoryFile(directory, 'displaced')
      // link fails if any destination entry exists, including a symlink. Never overwrite it.
      try { await fs.link(displaced.file, path.join(path.resolve(parentDir), info.noteFile)) }
      catch (error) { if (!existsError(error)) throw error }
      await atomicWriteFile(path.join(directory, 'metadata.json'), JSON.stringify({ ...info, state: 'complete' }))
      completedTransactions.add(directory)
    } catch { /* unsupported links, existing target, incomplete/unsafe transaction: retain for manual recovery */ }
  }
}

type Snapshot = { content: string; revision: string }
type Phase = 'afterInitialRead' | 'beforeCapture' | 'afterCapture' | 'beforePublish' | 'afterPublish'
type Context = { notePath: string; recoveryDirectory: string; displacedPath: string; draftPath: string }
export type NoteReplacementOptions = {
  /** Dependency seam for deterministic IO fault/race tests; never populated from environment variables. */
  onPhase?: (phase: Phase, context: Context) => Promise<void>
  link?: (source: string, target: string) => Promise<void>
}
export type NoteReplacementResult = { saved: true; recoveryDirectory: string } | { saved: false; conflict: Snapshot; recoveryDirectory: string }
const digest = (content: string) => createHash('sha256').update(content).digest('hex')
async function read(file: string): Promise<Snapshot> { const content = await fs.readFile(file, 'utf8'); return { content, revision: digest(content) } }
async function durableExclusive(file: string, content: string) {
  const handle = await fs.open(file, 'wx')
  try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
}
function existsError(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'EEXIST' }

/**
 * Preserve independent draft/before snapshots plus the actual displaced inode. This is not a
 * cross-process CAS: other editors can still write later. No recovery files are automatically pruned.
 * Unsupported hard links fail closed; never fall back to an overwriting rename/copy.
 */
export async function replaceNotePreservingHistory(notePath: string, requested: string, expectedRevision: string, options: NoteReplacementOptions = {}): Promise<NoteReplacementResult> {
  const target = path.resolve(notePath)
  const stat = await fs.lstat(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('일반 노트 파일만 안전하게 저장할 수 있습니다.')
  const recoveryDirectory = path.join(await historyRoot(target), randomUUID())
  const context = { notePath: target, recoveryDirectory, displacedPath: path.join(recoveryDirectory, 'displaced.md'), draftPath: path.join(recoveryDirectory, 'draft.md') }
  const publishPath = path.join(recoveryDirectory, 'publish.tmp')
  const link = options.link ?? fs.link
  const phase = (name: Phase) => options.onPhase?.(name, context)
  let captured = false
  let published = false
  let preflightFailed = false
  await fs.mkdir(recoveryDirectory, { recursive: true })
  activeTransactions.add(recoveryDirectory)
  let metadata: Record<string, unknown>
  const mark = async (state: string) => { metadata.state = state; await atomicWriteFile(path.join(recoveryDirectory, 'metadata.json'), JSON.stringify(metadata, null, 2)); if (state === 'complete') completedTransactions.add(recoveryDirectory) }
  try {
    const before = await read(target)
    await phase('afterInitialRead')
    await durableExclusive(context.draftPath, requested)
    await durableExclusive(path.join(recoveryDirectory, 'before.md'), before.content)
    metadata = { version: 1, state: 'pending', noteFile: path.basename(target), createdAt: new Date().toISOString(), expectedRevision, beforeRevision: before.revision, requestedRevision: digest(requested), files: { draft: 'draft.md', before: 'before.md', displaced: 'displaced.md' } }
    await durableExclusive(path.join(recoveryDirectory, 'metadata.json'), JSON.stringify(metadata, null, 2))
    if (before.revision !== expectedRevision) { await mark('complete'); return { saved: false, conflict: before, recoveryDirectory } }
    // Separate inode: an external in-place edit of target must not mutate the recovery draft.
    await durableExclusive(publishPath, requested)
    // Verify this filesystem supports exclusive hard-link publication before removing the live
    // name. Otherwise an exFAT/unsupported volume could strand both publication and restoration.
    const probePath = path.join(path.dirname(target), `.prism-note-link-probe-${randomUUID()}.tmp`)
    try { await link(publishPath, probePath) }
    catch (error) { preflightFailed = true; await mark('complete'); throw error }
    finally { await fs.unlink(probePath).catch(() => undefined) }
    await phase('beforeCapture')
    await replaceFileWithRetry(target, context.displacedPath)
    captured = true
    await phase('afterCapture')
    const displacedStat = await fs.lstat(context.displacedPath)
    if (!displacedStat.isFile() || displacedStat.isSymbolicLink()) throw new Error('외부 변경으로 노트 파일 형식이 바뀌었습니다. 원본을 보존하고 저장을 중단했습니다.')
    const displaced = await read(context.displacedPath)
    if (displaced.revision !== expectedRevision) {
      try { await link(context.displacedPath, target) } catch (error) { if (!existsError(error)) throw error }
      await mark('complete')
      return { saved: false, conflict: await read(target), recoveryDirectory }
    }
    await phase('beforePublish')
    // A crash after this marker may already have published: never resurrect a later user deletion.
    await mark('publishing')
    try { await link(publishPath, target) }
    catch (error) {
      if (!existsError(error)) throw error
      await mark('complete')
      return { saved: false, conflict: await read(target), recoveryDirectory }
    }
    published = true
    await mark('complete')
    await phase('afterPublish')
    await fs.unlink(publishPath)
    return { saved: true, recoveryDirectory }
  } catch (cause) {
    // Restore only if nobody else recreated target. Failure never justifies replacing their file.
    if (captured && !published) {
      try {
        try { await link(context.displacedPath, target) } catch (error) { if (!existsError(error)) throw error }
        await mark('complete')
      } catch { /* retained under displaced.md even if restoration is unavailable */ }
    }
    const message = preflightFailed
      ? `안전한 파일 교체 사전 확인에 실패하여 원본 파일을 교체하지 않았습니다. 작성한 초안은 복구 폴더에 보관했습니다: ${recoveryDirectory}`
      : `노트 저장을 완료하지 못했습니다. 복구 파일: ${recoveryDirectory}`
    throw Object.assign(new Error(message, { cause }), { recoveryDirectory, published })
  } finally {
    // publish.tmp is never the recovery draft; removing its extra link/copy does not remove
    // target or the independently stored draft, before snapshot, or displaced inode.
    await fs.unlink(publishPath).catch(() => undefined)
    activeTransactions.delete(recoveryDirectory)
  }
}
