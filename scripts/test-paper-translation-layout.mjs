import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transformWithOxc } from 'vite'
const { code } = await transformWithOxc(await fs.readFile('src/paper/paperLayout.ts', 'utf8'), 'src/paper/paperLayout.ts')
const { placePaperBlocks, clearCropBoundary } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const rect = (left,top,width,height) => ({left,top,width,height})
const blocks = [rect(40,40,240,80), rect(320,40,240,80), rect(40,140,240,50), rect(40,220,520,100), rect(40,340,240,40),rect(320,340,240,40)]
const positions = placePaperBlocks(blocks,[160,80,70,100,40,40],1)
assert.equal(positions[0],40)
assert.equal(positions[1],40) // growth in left column must not move the independent right column
assert(positions[2]>=220)
assert(positions[3]>=positions[2]+70) // spanning figure waits for both columns
assert(positions[4]>=positions[3]+100)
assert(positions[5]>=positions[3]+100)
for (let i=0;i<blocks.length;i++) for(let j=i+1;j<blocks.length;j++) {
  const a=blocks[i], b=blocks[j]
  if(Math.min(a.left+a.width,b.left+b.width)>Math.max(a.left,b.left)) assert(positions[j]>=positions[i]+[160,80,70,100,40,40][i])
}
const scaled=placePaperBlocks([rect(40,40,240,80),rect(40,140,240,50)],[40,25],.5)
assert.deepEqual(scaled,[20,70])
console.log('Paper translation layout passed: source margins, independent columns, expanded prose and spanning barriers without overlap.')

const metadata = [rect(40, 720, 200, 10), rect(40, 731, 80, 10)]
assert.equal(clearCropBoundary(725, metadata, 'before'), 718)
assert.equal(clearCropBoundary(725, metadata, 'after'), 743)
assert.equal(clearCropBoundary(700, metadata, 'after'), 700)
