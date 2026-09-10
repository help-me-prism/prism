import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseAiUsage, parseInputComposition, recordAiRun, readAiRuns } from '../dist-electron/aiUsage.js'
assert.deepEqual(parseInputComposition({ question: 1, paperEvidence: 2, selectedEvidence: 3, instructions: 4, source: 'must not enter journal' }, 10), { question: 1, paperEvidence: 2, selectedEvidence: 3, instructions: 4 })
assert.equal(parseInputComposition({ question: 'private prompt', paperEvidence: 0, selectedEvidence: 0, instructions: 0 }, 10), undefined)
assert.equal(parseInputComposition({ question: 1, paperEvidence: 2, selectedEvidence: 3, instructions: 4 }, 11), undefined)
assert.deepEqual(parseAiUsage('codex', { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20 }), { inputTokens: 100, cachedInputTokens: 60, outputTokens: 20 })
assert.deepEqual(parseAiUsage('claude', { input_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 30, output_tokens: 20 }), { inputTokens: 100, cachedInputTokens: 60, outputTokens: 20 })
assert.deepEqual(parseAiUsage('codex'), {})
assert.equal(parseAiUsage('codex', { input_tokens: -1 }).inputTokens, undefined)
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'prism-ai-usage-')))
try {
  const file = path.join(root, 'usage.json')
  await fs.writeFile(file, JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ id: String(i) }))))
  const row = { task: 'translation', provider: 'codex', model: 'fixture', startedAt: 1, durationMs: 100, inputCharacters: 100, status: 'completed' }
  await Promise.all([recordAiRun(file, { ...row, id: 'new-a' }), recordAiRun(file, { ...row, id: 'new-b' })])
  assert.equal((await readAiRuns(file)).length, 500)
  assert.deepEqual((await readAiRuns(file)).slice(-2).map(run => run.id), ['new-a', 'new-b'])
  await recordAiRun(file, { ...row, id: 'new-a', inputTokens: 42 })
  assert.equal((await readAiRuns(file)).filter(run => run.id === 'new-a').length, 1)
  console.log('AI usage passed: provider token normalization, unknown values, concurrent records, bounded retention, duplicate completion.')
} finally {
  assert.equal(path.dirname(root), await fs.realpath(os.tmpdir()))
  assert(path.basename(root).startsWith('prism-ai-usage-'))
  await fs.rm(root, { recursive: true, force: true })
}
