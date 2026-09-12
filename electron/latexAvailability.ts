import { gunzipSync } from 'node:zlib'
/** arXiv /src may return a PDF or an HTML error with HTTP 200. */
export function containsLatexSource(bytes: Buffer): boolean {
  let data = bytes
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try { data = gunzipSync(bytes, { maxOutputLength: 100 * 1024 * 1024 }) } catch { return false }
  }
  if (/^\s*(?:%[^\n]*\n\s*)*\\(?:documentclass|documentstyle)\b/.test(data.subarray(0, 8000).toString('utf8'))) return true
  for (let offset = 0; offset + 512 <= data.length;) {
    const name = data.subarray(offset, offset + 100).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(data.subarray(offset + 124, offset + 136).toString('ascii').replace(/\0.*$/, '').trim(), 8)
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > data.length) return false
    if (/\.tex$/i.test(name) && /\\(?:documentclass|begin\s*\{document\})/.test(data.subarray(offset + 512, offset + 512 + size).toString('utf8'))) return true
    if (!name) break
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return false
}
export function samePaperTitle(a: string, b: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  const left = normalize(a), right = normalize(b)
  return left.length >= 18 && left === right
}
