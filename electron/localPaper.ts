import { createHash } from 'node:crypto'
import path from 'node:path'
import { promises as fs } from 'node:fs'

export async function readLocalPaper(filePath: string) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size > 150 * 1024 * 1024) throw new Error('150 MB 이하의 PDF 파일을 선택해 주세요.')
  const bytes = await fs.readFile(filePath)
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('올바른 PDF 파일이 아닙니다.')
  const id = `local-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`
  const title = path.basename(filePath, path.extname(filePath)).replace(/[_\r\n]+/g, ' ').trim() || '제목 없는 논문'
  return { bytes, id, title }
}
