import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { transformWithOxc } from 'vite'
const {code}=await transformWithOxc(await fs.readFile('electron/chatImages.ts','utf8'),'electron/chatImages.ts')
const {resolveChatImages,readSavedFigure}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-chat-images-'))
try {
  const paper=path.join(root,'paper'), figures=path.join(paper,'figures')
  await fs.mkdir(figures,{recursive:true})
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=','base64')
  const file=path.join(figures,'p1-figure-1.png')
  await fs.writeFile(file,png)
  const library=[{arxivId:'paper',pdfPath:path.join(paper,'paper.pdf')}]
  const ref={paperId:'paper',anchorId:'p1-figure-1',label:'Figure 1'}
  assert.deepEqual(await resolveChatImages([ref],library),[{...ref,path:await fs.realpath(file)}])
  assert.equal((await readSavedFigure(ref,library)).dataUrl, 'data:image/png;base64,'+png.toString('base64'))
  const metadataPath=path.join(figures,'p1-figure-1.json')
  const rect={x:.1,y:.2,width:.5,height:.3}
  await fs.writeFile(metadataPath,JSON.stringify({rect,page:4}))
  assert.deepEqual((await readSavedFigure(ref,library)).rect,rect)
  await fs.writeFile(metadataPath,JSON.stringify({rect:{...rect,x:2},page:-1}))
  const invalid=await readSavedFigure(ref,library)
  assert.equal(invalid.rect,undefined);assert.equal(invalid.page,undefined)
  await fs.writeFile(metadataPath,'malformed')
  assert.equal((await readSavedFigure(ref,library)).rect,undefined)
  assert.equal((await resolveChatImages([ref,ref],library)).length,1,'Duplicate references cannot increase image cost')
  await assert.rejects(resolveChatImages(Array(5).fill(ref),library),/4개/)
  await assert.rejects(resolveChatImages([{...ref,paperId:'unknown'}],library))
  for(const anchorId of ['../outside','a/b','a\\b','..','a'.repeat(121)]) await assert.rejects(resolveChatImages([{...ref,anchorId}],library))
  await assert.rejects(resolveChatImages([{...ref,anchorId:'missing'}],library))
  await fs.writeFile(path.join(figures,'bad.png'),Buffer.alloc(70))
  await assert.rejects(resolveChatImages([{...ref,anchorId:'bad'}],library),/PNG/)
  const huge=Buffer.from(png);huge.writeUInt32BE(10000,16);huge.writeUInt32BE(10000,20)
  await fs.writeFile(path.join(figures,'huge.png'),huge)
  await assert.rejects(resolveChatImages([{...ref,anchorId:'huge'}],library),/픽셀/)
  const large=path.join(figures,'large.png');await fs.writeFile(large,png);await fs.truncate(large,20*1024*1024+1)
  await assert.rejects(resolveChatImages([{...ref,anchorId:'large'}],library),/20MB/)
  await fs.truncate(large,11*1024*1024)
  await fs.copyFile(large,path.join(figures,'large2.png'))
  await assert.rejects(resolveChatImages([{...ref,anchorId:'large'},{...ref,anchorId:'large2'}],library),/20MB/)
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'p1-figure-1.png'),png)
  // Directory junctions are supported on Windows without symlink privileges.
  const redirected=path.join(root,'redirected');await fs.mkdir(redirected)
  await fs.symlink(outside,path.join(redirected,'figures'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(resolveChatImages([ref],[{arxivId:'paper',pdfPath:path.join(redirected,'paper.pdf')}]),/벗어/)
  try {
    await fs.symlink(path.join(outside,'p1-figure-1.png'),path.join(figures,'external.png'),'file')
    await assert.rejects(resolveChatImages([{...ref,anchorId:'external'}],library),/벗어/)
  } catch(error) { if(error.code!=='EPERM')throw error; console.log('File symlink test unavailable without Windows symlink privilege; junction escape test passed.') }
  console.log('Chat image resolution passed: valid PNG, exact library identity, traversal/junction rejection and bounded count/bytes/pixels.')
} finally {
  const resolved=await fs.realpath(root), temporary=await fs.realpath(os.tmpdir())
  assert.equal(path.dirname(resolved),temporary)
  assert(path.basename(resolved).startsWith('prism-chat-images-'))
  await fs.rm(resolved,{recursive:true,force:true})
}
