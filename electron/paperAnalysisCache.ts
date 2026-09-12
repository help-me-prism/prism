import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWriteFile } from './atomicFile.js'

// Bump whenever extraction, source enrichment, or glyph geometry changes.
export const paperAnalysisVersion = 2
export type PaperAnalysis<S> = { segments: S[]; matched: number }
export async function readPaperAnalysis<S>(pdfPath: string, signature: string): Promise<PaperAnalysis<S> | null> {
  try {
    const cache = JSON.parse(await fs.readFile(path.join(path.dirname(pdfPath), 'reader-analysis.json'), 'utf8'))
    return cache.version === paperAnalysisVersion && cache.signature === signature && Array.isArray(cache.source?.segments)
      && cache.source.segments.length <= 20_000 && Number.isInteger(cache.source.matched) ? cache.source : null
  } catch { return null }
}
export async function writePaperAnalysis<S>(pdfPath: string, signature: string, source: PaperAnalysis<S>) {
  if (!/^[a-f0-9]{64}$/.test(signature) || !Array.isArray(source?.segments) || source.segments.length > 20_000 || !Number.isInteger(source.matched)) throw new Error('논문 분석 캐시가 올바르지 않습니다.')
  await atomicWriteFile(path.join(path.dirname(pdfPath), 'reader-analysis.json'), JSON.stringify({ version: paperAnalysisVersion, signature, source }))
  return true
}
