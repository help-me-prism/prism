import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { atomicWriteFile } from './atomicFile.js'

export type NoteSnapshot = {
  content: string
  revision: string
  modifiedAt: number
}

export type NoteSaveRequest = {
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
  const [content, stat] = await Promise.all([fs.readFile(notePath, 'utf8'), fs.stat(notePath)])
  return { content, revision: revisionOf(content), modifiedAt: stat.mtimeMs }
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

export async function saveNoteSnapshot(notePath: string, request: NoteSaveRequest): Promise<NoteSaveResult> {
  const disk = await readNoteSnapshot(notePath)
  if (!request.force && request.expectedRevision && disk.revision !== request.expectedRevision) {
    return { saved: false, conflict: disk }
  }

  await atomicWriteFile(notePath, request.content)
  announceNoteWritten(notePath)
  return { saved: true, snapshot: await readNoteSnapshot(notePath) }
}
