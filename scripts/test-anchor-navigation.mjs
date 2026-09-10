import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

// Exercise the actual navigation-completion callback, including React's queued
// updater contract. No PDF, timers, paid model, or test-only product branch.
const source = await fs.readFile('src/PaperWorkspace.tsx', 'utf8')
const marker = source.indexOf('      function center() {')
assert(marker >= 0, 'Navigation completion callback moved: update this harness')
const start = source.indexOf('{', marker)
let depth = 1, end = start + 1
for (; depth && end < source.length; end++) {
  if (source[end] === '{') depth++
  if (source[end] === '}') depth--
}
assert.equal(depth, 0)
const complete = Function('cancelled', 'window', 'pageSelector', 'anchor', 'deadline', 'performance', 'centerExplicitAnchor', 'anchorCatalog', 'showBacklinks', 'setError', 'setPendingAnchor', 'waitForTarget', 'explicitAnchorTarget', 'CSS', source.slice(start + 1, end - 1))
const old = { paperId: 'old-paper', anchorId: 'shared-anchor', openMemo: false }
const memo = { paperId: 'new-paper', anchorId: 'shared-anchor', openMemo: true }
function run(anchor, target, initial, queued = [], cancelled = false) {
  const updates = [...queued], opened = [], errors = []
  let centered = 0
  complete(cancelled, { document: { querySelector: () => ({ classList: { contains: () => true }, querySelector: () => ({}) }) } }, 'page', anchor, 0, { now: () => 1 }, () => centered++, [memo], value => opened.push(value), error => errors.push(error), update => updates.push(update), false, { current: target }, { escape: value => value })
  return { pending: updates.reduce((state, update) => typeof update === 'function' ? update(state) : update, initial), opened, errors, centered }
}
assert.equal(run(old, old, old).pending, undefined, 'The owned completed navigation must clear itself')
const interleaved = run(old, old, old, [memo])
assert.equal(interleaved.pending, memo, 'Old completion must preserve a newer memo already queued before React commits')
assert.equal(interleaved.centered, 1, 'This case exercises completion before the effect has observed the newer target')
const stale = run(old, memo, memo)
assert.equal(stale.pending, memo)
assert.equal(stale.centered, 0, 'An obsolete callback must not recenter the newer navigation')
const completedMemo = run(memo, memo, memo)
assert.equal(completedMemo.pending, undefined)
assert.deepEqual(completedMemo.opened, [memo], 'The current memo must still open its exact source')
assert.deepEqual(completedMemo.errors, [])
assert.equal(run(old, old, memo, [], true).pending, memo)
console.log('Anchor navigation completion passed: owned completion, queued newer memo, stale target, cancellation, and exact memo opening.')

// Scroll-induced mouse entry must not steal the explicit evidence highlight.
// Use the production callback: both mouse-enter IDs and mouse-leave undefined
// travel through this same gate in original and translated PDF panes.
const hoverStart = source.indexOf('  function highlightHoveredAnchor(anchorId?: string) {')
assert(hoverStart >= 0, 'Hover ownership callback moved: update this harness')
const hoverBodyStart = source.indexOf('{', hoverStart)
const hoverBodyEnd = source.indexOf('\n  }', hoverBodyStart)
const hover = Function('anchorId', 'pdfPaperId', 'activeIdRef', 'explicitAnchorTarget', 'setHighlighted', source.slice(hoverBodyStart + 1, hoverBodyEnd))
let highlight = 'p4-s6'
const owner = { current: { paperId: 'engineering', anchorId: 'p4-s6' } }
const hoverOn = (id, pdfPaper = 'engineering') => hover(id, pdfPaper, { current: 'engineering' }, owner, value => { highlight = value })
hoverOn('p4-s3')
assert.equal(highlight, 'p4-s6', 'Programmatic scrolling under another sentence must keep the exact memo source selected')
hoverOn(undefined)
assert.equal(highlight, 'p4-s6', 'Mouse leave must not erase the explicit source highlight')
owner.current = undefined // Existing wheel/pointerdown/navigation-key interrupt.
hoverOn('p4-s3')
assert.equal(highlight, 'p4-s3', 'Intentional reading resumes ordinary hover after navigation ownership ends')
hoverOn(undefined)
assert.equal(highlight, undefined)
hoverOn('foreign-anchor', 'biology')
assert.equal(highlight, undefined, 'A stale PDF pane cannot change the active paper highlight')
assert(source.includes('onHighlight={highlightHoveredAnchor} onTag='), 'The reader must route PDF hover through the ownership gate')
console.log('Anchor highlight ownership passed: scroll-induced enter/leave, user interruption and stale-paper events.')
