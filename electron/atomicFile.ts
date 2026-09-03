import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

type RenameOperation = (oldPath: string, newPath: string) => Promise<void>

function retryableRenameError(reason: unknown) {
  const code = (reason as NodeJS.ErrnoException)?.code
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
}

export async function replaceFileWithRetry(temporaryPath: string, targetPath: string, rename: RenameOperation = fs.rename) {
  for (let attempt = 0; ; attempt += 1) {
    try { await rename(temporaryPath, targetPath); return }
    catch (reason) {
      if (!retryableRenameError(reason) || attempt >= 7) throw reason
      await new Promise((resolve) => setTimeout(resolve, 12 * 2 ** attempt))
    }
  }
}

export async function atomicWriteFile(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    await replaceFileWithRetry(temporaryPath, filePath)
  } catch (reason) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw reason
  }
}
