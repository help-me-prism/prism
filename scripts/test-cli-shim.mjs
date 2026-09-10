import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crossSpawn from 'cross-spawn'
if (process.platform === 'win32') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prism-cli shim-'))
 try {
  const script=path.join(root,'echo.cjs'),shim=path.join(root,'cli.cmd')
  await fs.writeFile(script,'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  await fs.writeFile(shim,`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
  const expected=['--config','model_instructions_file="C:/folder with spaces/instructions.txt"','--tools','','한국어 & echo accidental','a|b','%PRISM_SHIM_NONEXISTENT%']
  const child=crossSpawn(shim,expected,{windowsHide:true,stdio:['pipe','pipe','pipe']})
  let out='';child.stdout.on('data',b=>out+=b)
  const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject)})
  assert.equal(code,0);assert.deepEqual(JSON.parse(out),expected)
  console.log('Windows CLI shim: spaces, JSON quotes, empty tool list, Korean, shell metacharacters preserved.')
 } finally {await fs.rm(root,{recursive:true,force:true})}
} else console.log('Windows CLI shim skipped on non-Windows host.')
