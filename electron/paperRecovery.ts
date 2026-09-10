import { createHash } from 'node:crypto'
import { promises as fs, createReadStream } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Only replace the unambiguous, exact PDF field written by Prism inside initial frontmatter. */
export function updateRecoveredPdfLink(content: string, oldPdfPath: string, newPdfPath: string): string | undefined {
  const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)(?=\r?\n|$)/.exec(content)
  if (!frontmatter) return undefined
  const body = frontmatter[2]
  // Duplicate or quoted/indented variants make ownership ambiguous; leave the document alone.
  const pdfFields = body.split(/\r?\n/).filter(line => /^\s*(?:pdf|"pdf"|'pdf')\s*:/.test(line))
  const oldLine = `pdf: ${JSON.stringify(pathToFileURL(oldPdfPath).href)}`
  if (pdfFields.length !== 1 || pdfFields[0] !== oldLine) return undefined
  const exactLine = [...body.matchAll(/[^\r\n]+/g)].find(match => match[0] === oldLine)!
  const offset = frontmatter[1].length + exactLine.index!
  const newLine = `pdf: ${JSON.stringify(pathToFileURL(newPdfPath).href)}`
  return content.slice(0, offset) + newLine + content.slice(offset + oldLine.length)
}

type RecoverablePaper = { arxivId: string; pdfPath: string; translationPath: string; sourcePath?: string; externalAssets?: boolean; pdfSha256?: string }
type RecoveryReason = 'missing-candidate' | 'no-fingerprint' | 'fingerprint-mismatch' | 'outside-root' | 'not-file'

function inside(root: string, target: string) {
  const relative = path.relative(root, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}
function missing(error: unknown) { return (error as NodeJS.ErrnoException)?.code === 'ENOENT' }
async function hashFile(file: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** Builds a new index only. Never copies, moves, deletes, or writes a paper or its assets. */
export async function planPaperRecovery<T extends RecoverablePaper>(records: readonly T[], selectedRoot: string) {
  const root = await fs.realpath(selectedRoot)
  if (!(await fs.stat(root)).isDirectory()) throw new Error('논문이 저장된 폴더를 선택해 주세요.')
  const result: T[] = []
  const failures: Array<{ arxivId: string; reason: RecoveryReason }> = []
  let restored = 0
  for (const record of records) {
    if (record.externalAssets !== true) { result.push(record); continue }
    try { await fs.stat(record.pdfPath); result.push(record); continue }
    catch (error) { if (!missing(error)) throw error }
    const skip = (reason: RecoveryReason) => { result.push(record); failures.push({ arxivId: record.arxivId, reason }) }
    const fullHash = record.pdfSha256
    const prefix = /^local-([a-f\d]{24})$/i.exec(record.arxivId)?.[1]
    // A stored but malformed full fingerprint must not silently fall back to a weaker identifier.
    if (fullHash ? !/^[a-f\d]{64}$/i.test(fullHash) : !prefix) { skip('no-fingerprint'); continue }
    const safeId = record.arxivId.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const candidate = path.resolve(root, safeId, path.basename(record.pdfPath))
    if (!inside(root, candidate) || safeId === '.' || safeId === '..' || !safeId) { skip('outside-root'); continue }
    let actual: string
    try { actual = await fs.realpath(candidate) }
    catch (error) { if (!missing(error)) throw error; skip('missing-candidate'); continue }
    if (!inside(root, actual)) { skip('outside-root'); continue }
    if (!(await fs.stat(actual)).isFile()) { skip('not-file'); continue }
    const digest = await hashFile(actual)
    if (fullHash ? digest !== fullHash.toLowerCase() : !digest.startsWith(prefix!.toLowerCase())) { skip('fingerprint-mismatch'); continue }
    const oldParent = path.dirname(path.resolve(record.pdfPath))
    const newParent = path.dirname(candidate)
    const remap = (value: string) => inside(oldParent, path.resolve(value)) ? path.resolve(newParent, path.relative(oldParent, path.resolve(value))) : value
    const translationPath = remap(record.translationPath)
    const sourcePath = record.sourcePath === undefined ? undefined : remap(record.sourcePath)
    // Reconnecting a directory must not indirectly expose an asset symlink outside that directory.
    let escaped = false
    for (const asset of [translationPath, sourcePath]) {
      if (!asset || !inside(newParent, asset)) continue
      try { if (!inside(root, await fs.realpath(asset))) escaped = true }
      catch (error) { if (!missing(error)) throw error }
    }
    if (escaped) { skip('outside-root'); continue }
    result.push({ ...record, pdfPath: candidate, translationPath, ...(sourcePath === undefined ? {} : { sourcePath }) })
    restored += 1
  }
  return { records: result, restored, skipped: failures.length, failures }
}
