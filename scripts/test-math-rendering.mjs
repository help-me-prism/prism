import assert from 'node:assert/strict'
import katex from 'katex'
import { displayMathForPreview } from '../dist-electron/mathRendering.js'

const source = String.raw`\label{eq:test}\frac{d}{dt}\phi_t(x) &= v_t(\phi_t(x)) \\ \phi_0(x) &= x`
const math = displayMathForPreview(source)
assert.doesNotMatch(math, /\\label/)
assert.match(math, /^\\begin\{aligned\}/)
assert.doesNotThrow(() => katex.renderToString(math, { displayMode: true, throwOnError: true }))
process.stdout.write('Math preview test passed: document labels and multiline alignment render in KaTeX.\n')
