import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

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

async function atomicWrite(notePath: string, content: string) {
  const temporaryPath = path.join(path.dirname(notePath), `.${path.basename(notePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporaryPath, notePath)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export async function saveNoteSnapshot(notePath: string, request: NoteSaveRequest): Promise<NoteSaveResult> {
  const disk = await readNoteSnapshot(notePath)
  if (!request.force && request.expectedRevision && disk.revision !== request.expectedRevision) {
    return { saved: false, conflict: disk }
  }

  await atomicWrite(notePath, request.content)
  return { saved: true, snapshot: await readNoteSnapshot(notePath) }
}
