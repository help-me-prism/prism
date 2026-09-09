import fs from 'node:fs/promises'
import path from 'node:path'

export type ChatFigureReference = { paperId: string; anchorId: string; label?: string }
export type ChatImage = { path: string; label: string; paperId: string; anchorId: string }
const MAX_IMAGES = 4
const MAX_BYTES = 20 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const inside = (root: string, target: string) => {
  const relative = path.relative(root, target)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Resolve only Prism-owned figure assets; renderer paths are never accepted. */
export async function resolveChatImages(references: ChatFigureReference[], library: Array<{ arxivId: string; pdfPath: string }>): Promise<ChatImage[]> {
  if (!Array.isArray(references) || references.length > MAX_IMAGES) throw new Error('피겨는 한 번에 최대 4개까지 첨부할 수 있습니다.')
  const result: ChatImage[] = [], seen = new Set<string>()
  let total = 0
  for (const reference of references) {
    if (!reference || typeof reference.paperId !== 'string' || typeof reference.anchorId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(reference.anchorId) || reference.anchorId === '.' || reference.anchorId === '..') throw new Error('피겨 참조가 올바르지 않습니다.')
    const key = JSON.stringify([reference.paperId, reference.anchorId])
    if (seen.has(key)) continue
    seen.add(key)
    const record = library.find(paper => paper.arxivId === reference.paperId)
    if (!record || typeof record.pdfPath !== 'string') throw new Error('라이브러리에서 피겨의 논문을 찾을 수 없습니다.')
    const paperDirectory = await fs.realpath(path.dirname(record.pdfPath))
    const figureDirectory = await fs.realpath(path.join(paperDirectory, 'figures'))
    if (!inside(paperDirectory, figureDirectory)) throw new Error('피겨 폴더가 논문 저장 위치를 벗어났습니다.')
    const imagePath = await fs.realpath(path.join(figureDirectory, `${reference.anchorId}.png`))
    if (!inside(figureDirectory, imagePath)) throw new Error('피겨 파일이 허용된 폴더를 벗어났습니다.')
    const file = await fs.open(imagePath, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size < 33 || stat.size > MAX_BYTES || total + stat.size > MAX_BYTES) throw new Error('피겨 파일은 전체 20MB 이하의 PNG여야 합니다.')
      const header = Buffer.alloc(33)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      if (bytesRead !== 33 || !header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || header.readUInt32BE(8) !== 13 || header.toString('ascii',12,16) !== 'IHDR') throw new Error('피겨가 올바른 PNG 형식이 아닙니다.')
      const width = header.readUInt32BE(16), height = header.readUInt32BE(20)
      if (!width || !height || width * height > MAX_PIXELS) throw new Error('피겨 이미지 크기는 2,500만 픽셀 이하여야 합니다.')
      const depths: Record<number, number[]> = { 0:[1,2,4,8,16], 2:[8,16], 3:[1,2,4,8], 4:[8,16], 6:[8,16] }
      if (!depths[header[25]]?.includes(header[24])) throw new Error('지원하지 않는 PNG 색상 형식입니다.')
      if (header[26] !== 0 || header[27] !== 0 || header[28] > 1) throw new Error('지원하지 않는 PNG 이미지입니다.')
      total += stat.size
    } finally { await file.close() }
    result.push({ path: imagePath, label: typeof reference.label === 'string' ? reference.label.slice(0,200) : reference.anchorId, paperId: reference.paperId, anchorId: reference.anchorId })
  }
  return result
}
