import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'

/**
 * Notes now write themselves, which means a note can change while nobody is looking at it. Marking a
 * concept in faint italics said the wrong thing — it read as "unfinished" for a note Prism had just
 * finished writing. What the tree actually needs to say is "there is something here you have not read
 * yet", and that is a claim only the researcher can retire, by reading it and saying so.
 *
 * Kept beside the other derived state in `.prism/cache/`, so deleting the folder loses nothing but the
 * unread marks.
 */
export type AutoUnreadEntry = { at: number; sections: string[] }
export type AutoUnreadMap = Record<string, AutoUnreadEntry>

function unreadPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'cache', 'auto-unread.json') }

export async function listAutoUnread(libraryPath: string): Promise<AutoUnreadMap> {
  try {
    const value = JSON.parse(await fs.readFile(unreadPath(libraryPath), 'utf8')) as AutoUnreadMap
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value
  } catch { return {} }
}

/** Sections accumulate: two runs that each add one line leave one mark naming both. */
export async function markAutoWritten(libraryPath: string, nodeId: string, sections: string[]) {
  if (!sections.length) return
  const current = await listAutoUnread(libraryPath)
  const merged = [...new Set([...(current[nodeId]?.sections ?? []), ...sections])]
  await atomicWriteFile(unreadPath(libraryPath), JSON.stringify({ ...current, [nodeId]: { at: Date.now(), sections: merged } }, null, 2))
}

export async function clearAutoUnread(libraryPath: string, nodeId: string) {
  const current = await listAutoUnread(libraryPath)
  if (!(nodeId in current)) return false
  const { [nodeId]: _read, ...rest } = current
  await atomicWriteFile(unreadPath(libraryPath), JSON.stringify(rest, null, 2))
  return true
}
