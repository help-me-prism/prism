import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { transformWithOxc } from 'vite'
import { atomicWriteFile } from '../dist-electron/atomicFile.js'
import * as harness from '../dist-electron/translationHarness.js'
import * as scope from '../dist-electron/translationScope.js'

const source = await fs.readFile('electron/main.ts', 'utf8')
const body = source.slice(source.indexOf('function cachedSegments('), source.indexOf('let mainWindow:'))
const { code } = await transformWithOxc(body, 'translation-runtime.ts')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-translation-concurrency-'))

const sentence = 'The measured response of the cultured cells to the applied stimulus was recorded and compared against the untreated control group under identical conditions. '
const segments = Array.from({ length: 90 }, (_, index) => ({ id: `s${index}`, page: 1 + Math.floor(index / 12), kind: 'text', source: `${sentence.repeat(3)}Observation ${'x'.repeat(20)} of run ${'y'.repeat(10)}.` }))

async function run({ failAt, cancelAt } = {}) {
  const file = path.join(root, `translation-${failAt !== undefined ? 'fail-' + failAt : cancelAt !== undefined ? 'cancel-' + cancelAt : 'ok'}.json`)
  const runs = new Map()
  const events = []
  let started = 0; let inFlight = 0; let peak = 0
  const deps = {
    fs, createHash, atomicWriteFile, ...harness, ...scope,
    readSettings: async () => ({ translationProvider: 'codex', translationModel: 'fixture' }),
    translationRuns: runs,
    reportTranslation: (_sender, channel, event) => events.push({ channel, ...event }),
    runTranslationCli: async (_provider, _model, prompt, key) => {
      const index = started++
      inFlight += 1; peak = Math.max(peak, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 20))
        if (index === failAt) throw new Error('fixture failure')
        if (index === cancelAt) runs.get(key).cancelled = true
        const data = JSON.parse(prompt.split('INPUT:\n')[1].split('\nCopy each short')[0])
        return JSON.stringify(data.items.map((item) => ({ id: item.id, translation: '배양된 세포의 측정 반응을 대조군과 비교해 기록했습니다.' })))
      } finally { inFlight -= 1 }
    },
  }
  const translatePaper = Function(...Object.keys(deps), code + ';return translatePaper')(...Object.values(deps))
  const record = { arxivId: 'fixture', translationPath: file }
  const result = await translatePaper({}, record, segments, false).then(() => undefined, (reason) => reason)
  return { file, events, started, peak, runs, error: result }
}

const ok = await run()
assert.equal(ok.error, undefined)
assert(ok.started >= 4, `fixture must produce several batches, saw ${ok.started}`)
assert(ok.peak > 1, 'independent batches must not wait for one another')
assert(ok.peak <= 3, `at most three batches may be in flight, saw ${ok.peak}`)
const saved = JSON.parse(await fs.readFile(ok.file, 'utf8')).segments
assert.equal(saved.length, segments.length)
assert(saved.every((segment) => segment.translation), 'every in-scope segment is translated exactly once')
const done = ok.events.filter((event) => event.channel === 'translation:done')
assert.equal(done.length, 1)
assert.equal(done[0].warning, undefined, 'no batch may be rejected by the preservation gate')
const progress = ok.events.filter((event) => event.channel === 'translation:progress' && event.completed)
assert.deepEqual(progress.map((event) => event.completed), progress.map((_, index) => index + 1), 'progress counts completed batches, not their start order')
assert.equal(progress.at(-1).completed, ok.started)
assert.equal(ok.runs.size, 0, 'the paper lock is released')

// A failing batch must surface, and must not leave later batches running behind it.
const failed = await run({ failAt: 1 })
assert.match(String(failed.error), /fixture failure/)
const startedAtFailure = failed.started
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal(failed.started, startedAtFailure, 'no batch starts after the failure is known')
assert(failed.started < ok.started, 'the remaining batches are abandoned')
assert.equal(failed.runs.size, 0)

// Cancelling stops the queue and keeps whatever was already saved.
const cancelled = await run({ cancelAt: 0 })
assert.equal(cancelled.error, undefined)
const startedAtCancel = cancelled.started
await new Promise((resolve) => setTimeout(resolve, 80))
assert.equal(cancelled.started, startedAtCancel, 'no batch starts after cancellation')
assert(cancelled.started < ok.started, 'cancellation stops the queue')
assert.equal(cancelled.events.filter((event) => event.channel === 'translation:done' && !event.cancelled).length, 0)
assert.equal(cancelled.events.filter((event) => event.channel === 'translation:done' && event.cancelled).length, 1, 'Cancellation publishes terminal status')
assert.equal(cancelled.runs.size, 0)

await fs.rm(root, { recursive: true, force: true })
console.log('Translation concurrency: batches overlap within the bound, progress stays ordered, failure and cancellation stop the queue.')
