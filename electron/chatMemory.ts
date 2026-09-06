import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'

/**
 * Which sections a conversation has taken over.
 *
 * The chat-derived parts of a note used to be guessed at by rule: split every user message into sentences,
 * keep the ones with a question mark or a question word, merge them by word stem. That finds questions and
 * misses everything else a conversation settles, and it cannot correct itself when an answer turns out to be
 * wrong. Now the model writing the answer decides in the same turn, which is what assistants with a memory
 * actually do — and which means those rules must stop overwriting it.
 *
 * They are still worth keeping as a floor: a researcher with no CLI configured should not end up with a note
 * that says nothing. So the rules seed a section that no conversation has claimed, and stand down for good
 * on the ones that have been.
 *
 * Derived state, kept beside the other derived state in `.prism/cache/`. Deleting it loses nothing but the
 * handover: the rules resume seeding, which is where they started.
 */
export type ChatMemoryMap = Record<string, { at: number; sections: string[] }>

function memoryPath(libraryPath: string) { return path.join(libraryPath, '.prism', 'cache', 'chat-memory.json') }

export async function listChatMemory(libraryPath: string): Promise<ChatMemoryMap> {
  try {
    const value = JSON.parse(await fs.readFile(memoryPath(libraryPath), 'utf8')) as ChatMemoryMap
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value
  } catch { return {} }
}

export async function markChatWritten(libraryPath: string, nodeId: string, sections: string[]) {
  if (!sections.length) return
  const current = await listChatMemory(libraryPath)
  const merged = [...new Set([...(current[nodeId]?.sections ?? []), ...sections])]
  await atomicWriteFile(memoryPath(libraryPath), JSON.stringify({ ...current, [nodeId]: { at: Date.now(), sections: merged } }, null, 2))
}

/** True when a conversation owns this section and the deterministic rules should leave it alone. */
export function claimedByChat(memory: ChatMemoryMap, nodeId: string, section: string) {
  return Boolean(memory[nodeId]?.sections.includes(section))
}
