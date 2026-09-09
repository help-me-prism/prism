import assert from 'node:assert/strict'
import { withoutBibliography } from '../dist-electron/translationScope.js'
const items = [
  {kind:'text', source:'References to the method are discussed here.'},
  {kind:'heading', source:'6 References'},
  {kind:'text', source:'Author (2024). A cited work.'},
  {kind:'heading', source:'Appendix A. Additional experiments'},
  {kind:'text', source:'The experiment used 24 samples.'},
]
assert.deepEqual(withoutBibliography(items), [items[0],items[3],items[4]])
assert.deepEqual(withoutBibliography(items.slice(0,1)),items.slice(0,1))
console.log('Translation scope passed: bibliography excluded from body, appendices retained, prose mentions unaffected.')
