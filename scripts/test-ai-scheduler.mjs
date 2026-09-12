import assert from 'node:assert/strict'
import { createAiScheduler } from '../dist-electron/aiScheduler.js'
const schedule = createAiScheduler(3)
const active = new Map(), peak = new Map(), starts = [], releases = []
const task = (provider, id, signal) => schedule(provider, async () => {
  starts.push(id)
  active.set(provider, (active.get(provider) ?? 0) + 1)
  peak.set(provider, Math.max(peak.get(provider) ?? 0, active.get(provider)))
  try { await new Promise(resolve => releases.push(resolve)) } finally { active.set(provider, active.get(provider) - 1) }
  return id
}, signal)
const tick = () => new Promise(resolve => setImmediate(resolve))
const cancelled = new AbortController()
const jobs = [...Array.from({length: 6}, (_, i) => task('codex', 'paper-' + i)), task('claude', 'other-provider')]
const omitted = task('codex', 'cancelled-paper', cancelled.signal)
const rejected = assert.rejects(omitted, /cancelled/)
cancelled.abort(new Error('cancelled'))
await tick()
assert.deepEqual(starts, ['paper-0','paper-1','paper-2','other-provider'])
releases.splice(0).forEach(resolve => resolve())
await tick()
assert.deepEqual(starts.slice(4), ['paper-3','paper-4','paper-5'], 'FIFO across papers')
releases.splice(0).forEach(resolve => resolve())
await Promise.all([...jobs, rejected])
assert.equal(peak.get('codex'), 3)
assert(!starts.includes('cancelled-paper'))
await assert.rejects(schedule('codex', () => { throw Error('spawn failed') }), /spawn failed/)
assert.equal(await schedule('codex', async () => 'recovered'), 'recovered', 'Failures release slots')
const pre = new AbortController(); pre.abort(Error('already cancelled'))
await assert.rejects(schedule('codex', () => { throw Error('must not run') }, pre.signal), /already cancelled/)
console.log('AI scheduler: provider-wide bound, independent providers, FIFO, queued cancellation and failure recovery passed.')
