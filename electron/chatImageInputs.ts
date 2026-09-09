/** Pure wire-format builders. File authorization, decoding/resizing and model choice belong to the caller. */
export const MAX_CHAT_IMAGES = 4
// Conservative app limits: below Claude CLI's documented 10 MB stdin ceiling,
// including JSON/base64 overhead and the smaller partner per-image allowance.
export const MAX_CLAUDE_IMAGE_BASE64_BYTES = 5_000_000
export const MAX_CLAUDE_INPUT_BYTES = 8_000_000
export type ClaudeImageInput = { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string }
export type CodexImageInput = { type: 'text'; text: string; text_elements: [] } | { type: 'localImage'; path: string }

function validateCount(count: number) {
  if (count > MAX_CHAT_IMAGES) throw new Error(`한 번에 이미지는 ${MAX_CHAT_IMAGES}개까지 질문할 수 있습니다.`)
}

export function buildCodexImageInputs(prompt: string, imagePaths: string[] = []): CodexImageInput[] {
  validateCount(imagePaths.length)
  if (imagePaths.some(value => typeof value !== 'string' || !value.trim() || value.includes('\0'))) throw new Error('이미지 경로가 올바르지 않습니다.')
  return [{ type: 'text', text: prompt, text_elements: [] }, ...imagePaths.map(path => ({ type: 'localImage' as const, path }))]
}

function imageBlock(image: ClaudeImageInput) {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mediaType)) throw new Error('지원하지 않는 이미지 형식입니다.')
  if (image.data.length > MAX_CLAUDE_IMAGE_BASE64_BYTES) throw new Error('이미지가 너무 큽니다. 필요한 영역만 선택해 주세요.')
  // Reject data URLs, whitespace and malformed padding instead of passing them to a paid request.
  if (!image.data || image.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)) throw new Error('이미지 데이터가 올바르지 않습니다.')
  const bytes = Buffer.from(image.data, 'base64')
  if (bytes.toString('base64') !== image.data) throw new Error('이미지 데이터가 올바르지 않습니다.')
  const signatureMatches = image.mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : image.mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : image.mediaType === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!signatureMatches) throw new Error('이미지 내용과 형식이 일치하지 않습니다.')
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } }
}

/** Pass with -p --input-format stream-json --output-format stream-json --verbose. */
export function buildClaudeImageMessage(prompt: string, images: ClaudeImageInput[] = []): string {
  validateCount(images.length)
  const message = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(imageBlock)] }, parent_tool_use_id: null }
  const line = JSON.stringify(message) + '\n'
  if (Buffer.byteLength(line, 'utf8') > MAX_CLAUDE_INPUT_BYTES) throw new Error('질문과 이미지의 전체 크기가 너무 큽니다. 이미지 수나 선택 영역을 줄여 주세요.')
  return line
}
