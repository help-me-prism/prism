import assert from 'node:assert/strict'
import { buildClaudeImageMessage, buildCodexImageInputs, MAX_CLAUDE_INPUT_BYTES, MAX_CLAUDE_IMAGE_BASE64_BYTES } from '../dist-electron/chatImageInputs.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL9sAAAAASUVORK5CYII='
const prompt = '표의 ≥ 값은?\n두 번째 줄 "인용"'
const line = buildClaudeImageMessage(prompt, [{ mediaType: 'image/png', data: png }])
assert.equal(line.split('\n').length, 2, 'one complete NDJSON line despite prompt newlines')
const parsed = JSON.parse(line)
assert.equal(parsed.parent_tool_use_id, null)
assert.equal(parsed.message.role, 'user')
assert.equal(parsed.message.content[0].text, prompt)
assert.equal(parsed.message.content[1].source.media_type, 'image/png')
assert.equal(Buffer.from(parsed.message.content[1].source.data, 'base64').toString('base64'), png)
assert.deepEqual(buildCodexImageInputs(prompt, ['C:\\논문 폴더\\그림.png']), [{ type: 'text', text: prompt, text_elements: [] }, { type: 'localImage', path: 'C:\\논문 폴더\\그림.png' }])
assert.equal(JSON.parse(buildClaudeImageMessage(prompt)).message.content.length, 1)
assert.throws(() => buildClaudeImageMessage(prompt, [{ mediaType: 'image/jpeg', data: png }]), /형식/)
assert.throws(() => buildClaudeImageMessage(prompt, [{ mediaType: 'image/png', data: `data:image/png;base64,${png}` }]), /데이터/)
assert.throws(() => buildClaudeImageMessage(prompt, [{ mediaType: 'image/png', data: 'AAA' }]), /데이터/)
assert.throws(() => buildClaudeImageMessage(prompt, [{ mediaType: 'image/svg+xml', data: png }]), /지원/)
assert.throws(() => buildClaudeImageMessage(prompt, Array.from({ length: 5 }, () => ({ mediaType: 'image/png', data: png }))), /4개/)
assert.throws(() => buildCodexImageInputs(prompt, ['bad\0path']), /경로/)
assert.throws(() => buildClaudeImageMessage(prompt, [{ mediaType: 'image/png', data: 'A'.repeat(MAX_CLAUDE_IMAGE_BASE64_BYTES + 4) }]), /너무 큽니다/)
assert.throws(() => buildClaudeImageMessage('한'.repeat(Math.ceil(MAX_CLAUDE_INPUT_BYTES / 3))), /전체 크기/, 'budget counts UTF-8 bytes, not JS characters')
// Large payloads must fail the aggregate budget, not a regex stack overflow.
// This signature-only fixture tests transport validation, not image decoding.
const largeBytes = Buffer.alloc(3_300_000)
Buffer.from(png, 'base64').subarray(0, 8).copy(largeBytes)
const largeImage = { mediaType: 'image/png', data: largeBytes.toString('base64') }
assert.throws(() => buildClaudeImageMessage(prompt, [largeImage, largeImage]), /전체 크기/)
console.log('Chat image wire-format tests passed (offline, no CLI inference).')
