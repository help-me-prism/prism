import { promises as fs } from 'node:fs'
import { atomicWriteFile } from './atomicFile.js'

import type { AiUsage, AiRun } from './aiUsageTypes.js'
export type { AiUsage, AiRun } from './aiUsageTypes.js'
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
export function parseAiUsage(provider: string, value: Record<string, unknown> | undefined): AiUsage {
  if (!value) return {}
  if (provider === 'claude') {
    const input = count(value.input_tokens), read = count(value.cache_read_input_tokens), written = count(value.cache_creation_input_tokens)
    return { inputTokens: input === undefined ? undefined : input + (read ?? 0) + (written ?? 0), cachedInputTokens: read, outputTokens: count(value.output_tokens) }
  }
  return { inputTokens: count(value.input_tokens ?? value.inputTokens), cachedInputTokens: count(value.cached_input_tokens ?? value.cachedInputTokens), outputTokens: count(value.output_tokens ?? value.outputTokens) }
}

export async function readAiRuns(file: string): Promise<AiRun[]> {
  try { const value = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(value) ? value.slice(-500) : [] } catch { return [] }
}
let writing = Promise.resolve()
export function recordAiRun(file: string, run: AiRun) {
  writing = writing.then(async () => {
    const previous = await readAiRuns(file)
    await atomicWriteFile(file, JSON.stringify([...previous.filter(item => item.id !== run.id), run].slice(-500), null, 2))
  }).catch(error => console.error('AI usage record could not be saved:', error))
  return writing
}
