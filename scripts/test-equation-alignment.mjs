import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'

const file = 'src/paper/equationAlignment.ts'
const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
const { monotoneMatches } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

assert.deepEqual(monotoneMatches([
  [.91, .08, .02, .01],
  [.06, .20, .10, .05], // damaged/unprinted source equation: must be skipped
  [.02, .14, .94, .18],
  [.01, .05, .12, .96],
], .42), [
  { leftIndex: 0, rightIndex: 0 },
  { leftIndex: 2, rightIndex: 2 },
  { leftIndex: 3, rightIndex: 3 },
], 'A weak earlier equation cannot shift strong later matrix matches')

assert.deepEqual(monotoneMatches([[.8, .1, .05], [.1, .12, .85]], .42), [
  { leftIndex: 0, rightIndex: 0 }, { leftIndex: 1, rightIndex: 2 },
], 'An extra PDF fragment can be skipped without breaking order')
console.log('Equation alignment passed: damaged LaTeX/PDF entries are skipped while later equations stay aligned.')
