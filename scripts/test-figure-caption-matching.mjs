import assert from 'node:assert/strict'
import { matchFigureCaptions } from '../dist-electron/figureCaptionMatching.js'

const matched = matchFigureCaptions([
  { id: 'source-5', order: 4, caption: 'Image quality as measured by FID across training.' },
  { id: 'source-6', order: 5, caption: 'Samples from the trained models.' },
  { id: 'source-4', order: 3, caption: 'Conditional vector fields and paths.' },
], [
  { id: 'pdf-6', source: 'Figure 6. Samples from the trained models.' },
  { id: 'pdf-5', source: 'Figure 5. Image quality as measured by FID across training.' },
  { id: 'pdf-4-short', source: 'Figure 4.' },
  { id: 'pdf-4', source: 'Figure 4. Conditional vector fields and paths.' },
])

assert.deepEqual(matched.map(figure => figure.captionAnchorId), ['pdf-5', 'pdf-6', 'pdf-4'])
process.stdout.write('Figure caption matching test passed: printed numbers beat PDF extraction order.\n')
