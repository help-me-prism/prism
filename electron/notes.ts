import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { replaceNotePreservingHistory } from './noteReplacement.js'

export type NoteSnapshot = {
  content: string
  revision: string
  modifiedAt: number
}

export type NoteSaveRequest = {
  vaultId?: string
  content: string
  expectedRevision?: string
  force?: boolean
  /** Create empty Concept stubs for unresolved [[links]]; only sent on explicit saves, never from the autosave timer. */
  createStubs?: boolean
}

export type NoteSaveResult =
  | { saved: true; snapshot: NoteSnapshot; stubs?: string[] }
  | { saved: false; conflict: NoteSnapshot }

function revisionOf(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export async function readNoteSnapshot(notePath: string): Promise<NoteSnapshot> {
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await fs.open(notePath, 'r')
      try {
        const content = await handle.readFile('utf8'); const stat = await handle.stat()
        return { content, revision: revisionOf(content), modifiedAt: stat.mtimeMs }
      } finally { await handle.close() }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT' || attempt >= 4) throw reason
      await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}

/**
 * Every note write funnels through `saveNoteSnapshot`, so this is the one place that can tell the rest of the
 * app that a file on disk is no longer what it was. Readers that cache by mtime subscribe here rather than
 * trusting the clock: two writes inside the same millisecond would otherwise look like no write at all.
 */
type NoteWriteListener = (notePath: string) => void
const noteWriteListeners = new Set<NoteWriteListener>()
export function onNoteWritten(listener: NoteWriteListener) { noteWriteListeners.add(listener); return () => { noteWriteListeners.delete(listener) } }
function announceNoteWritten(notePath: string) { for (const listener of noteWriteListeners) try { listener(notePath) } catch { /* a stale cache must never break a save */ } }

const noteWrites = new Map<string, Promise<unknown>>()
const writeKey = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
export async function waitForNoteWrite(notePath: string) {
  await noteWrites.get(writeKey(notePath))?.catch(() => undefined)
}
export async function waitForNoteDirectoryWrites(directory: string) {
  const key = writeKey(directory)
  await Promise.allSettled([...noteWrites].filter(([file]) => path.dirname(file) === key).map(([, operation]) => operation))
}
export async function saveNoteSnapshot(notePath: string, request: NoteSaveRequest): Promise<NoteSaveResult> {
  const key = writeKey(notePath)
  const operation = (noteWrites.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => saveSerialized(notePath, request))
  noteWrites.set(key, operation)
  try { return await operation } finally { if (noteWrites.get(key) === operation) noteWrites.delete(key) }
}
async function saveSerialized(notePath: string, request: NoteSaveRequest): Promise<NoteSaveResult> {
  const disk = await readNoteSnapshot(notePath)
  if (disk.content === request.content) return { saved: true, snapshot: disk }
  // Even a conflict already visible here must retain the submitted draft on disk.
  const expected = !request.force && request.expectedRevision ? request.expectedRevision : disk.revision
  const replacement = await replaceNotePreservingHistory(notePath, request.content, expected)
  if (!replacement.saved) return { saved: false, conflict: await readNoteSnapshot(notePath) }
  announceNoteWritten(notePath)
  const snapshot = await readNoteSnapshot(notePath)
  return snapshot.content === request.content ? { saved: true, snapshot } : { saved: false, conflict: snapshot }
}
