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
}

export type NoteSaveResult =
  | { saved: true; snapshot: NoteSnapshot }
  | { saved: false; conflict: NoteSnapshot }

function revisionOf(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

export async function readNoteSnapshot(notePath: string): Promise<NoteSnapshot> {
  const [content, stat] = await Promise.all([fs.readFile(notePath, 'utf8'), fs.stat(notePath)])
  return { content, revision: revisionOf(content), modifiedAt: stat.mtimeMs }
}

export async function saveNoteSnapshot(notePath: string, request: NoteSaveRequest): Promise<NoteSaveResult> {
  const disk = await readNoteSnapshot(notePath)
  if (!request.force && request.expectedRevision && disk.revision !== request.expectedRevision) {
    return { saved: false, conflict: disk }
  }

  await atomicWriteFile(notePath, request.content)
  return { saved: true, snapshot: await readNoteSnapshot(notePath) }
}
