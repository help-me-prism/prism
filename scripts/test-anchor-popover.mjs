import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'

const file = 'src/paper/anchorPopover.ts'
const { code } = await transformWithOxc(await fs.readFile(file, 'utf8'), file)
const { anchorPopoverPosition } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

assert.deepEqual(anchorPopoverPosition({ left: 180, right: 220, top: 300, bottom: 320, width: 40, height: 20 }, { width: 160, height: 100 }, { width: 400, height: 500 }), { left: 200, top: 192 })
assert.deepEqual(anchorPopoverPosition({ left: 2, right: 42, top: 4, bottom: 24, width: 40, height: 20 }, { width: 160, height: 100 }, { width: 400, height: 500 }), { left: 88, top: 32 }, 'Top-left anchors flip below and remain within the viewport')
assert.deepEqual(anchorPopoverPosition({ left: 380, right: 420, top: 480, bottom: 500, width: 40, height: 20 }, { width: 600, height: 600 }, { width: 400, height: 500 }), { left: 200, top: 8 }, 'Oversized previews are constrained without escaping the viewport')
console.log('Anchor popover positioning passed: clipped ancestors, viewport edges, flip and oversized previews.')
