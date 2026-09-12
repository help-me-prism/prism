import assert from 'node:assert/strict'
import { readCliTaskResult } from '../dist-electron/cliTaskResult.js'
const event = (type, fields = {}) => JSON.stringify({type,...fields})
const answer = event('item.completed',{item:{type:'agent_message',text:'{"changes":[]}'}})
assert.equal(readCliTaskResult('codex',answer+'\n'+event('turn.completed')),'{"changes":[]}')
assert.throws(()=>readCliTaskResult('codex',answer),/완료/,'Partial output with exit zero is not success')
assert.throws(()=>readCliTaskResult('codex',answer+'\n'+event('turn.failed',{error:{message:'quota exhausted'}})),/quota exhausted/)
assert.equal(readCliTaskResult('claude',JSON.stringify({subtype:'success',result:'[]'})),'[]')
assert.throws(()=>readCliTaskResult('claude',JSON.stringify({is_error:true,result:'quota exhausted'})),/실패/)
assert.throws(()=>readCliTaskResult('claude',JSON.stringify({subtype:'error_max_turns',result:'partial'})),/실패/)
assert.throws(()=>readCliTaskResult('claude',JSON.stringify({result:''})),/최종 응답/)
console.log('CLI task results: final completion, zero-exit provider errors, empty/truncated replies passed.')
