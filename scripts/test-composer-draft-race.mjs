import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/composerDraft.ts', 'utf8'), 'src/paper/composerDraft.ts')
const { composerLease } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

async function delayedFailure(intervene) {
  let composer = { sessionId: 'a', revision: 0, text: 'sent question', anchors: ['evidence-a'] }
  const draft = { ...composer }
  composer = { ...composer, revision: 1, text: '', anchors: [] }
  const owns = composerLease({ ...composer }, () => composer)
  let release
  const gate = new Promise(resolve => { release = resolve })
  const failedSend = (async () => {
    await gate
    if (owns()) composer = { ...composer, revision: composer.revision + 1, text: draft.text, anchors: draft.anchors }
  })()
  composer = intervene(composer)
  release(); await failedSend
  return composer
}

assert.equal((await delayedFailure(state => state)).text, 'sent question', 'A failed request restores its untouched draft')
assert.equal((await delayedFailure(state => ({ ...state, revision: 2, text: 'next question' }))).text, 'next question', 'Late failure cannot overwrite a newer question')
const switched = await delayedFailure(state => ({ ...state, sessionId: 'b', revision: 2, text: 'other conversation', anchors: ['b'] }))
assert.equal(switched.text, 'other conversation'); assert.deepEqual(switched.anchors, ['b'])
assert.equal((await delayedFailure(state => ({ ...state, revision: 3, text: '' }))).text, '', 'Typing then deleting is still a new draft; do not resurrect old content')
assert.equal((await delayedFailure(state => ({ ...state, revision: 2, anchors: ['new-evidence'] }))).text, '', 'A newly tagged source also owns the composer')
console.log('Composer race passed: delayed failure preserves newer text, anchors, other sessions and intentional empty drafts.')
