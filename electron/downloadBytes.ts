/** Bound memory even when a server omits or lies about Content-Length. */
export async function downloadBytes(response: Response, limit = 150 * 1024 * 1024) {
  if (!response.ok || !response.body) throw new Error(`파일 다운로드에 실패했습니다 (${response.status}).`)
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('파일이 너무 큽니다. 150 MB 이하의 PDF를 가져와 주세요.') }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error('다운로드 용량 제한을 초과했습니다.') }
      chunks.push(value)
    }
    return Buffer.concat(chunks, size)
  } finally { reader.releaseLock() }
}
