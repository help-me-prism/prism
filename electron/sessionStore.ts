import { promises as fs } from 'node:fs'
import { atomicWriteFile } from './atomicFile.js'

export function createSessionStore(file: string) {
  let writing = Promise.resolve()
  async function read() {
    try {
      const text = await fs.readFile(file, 'utf8')
      const value = JSON.parse(text)
      if (!Array.isArray(value)) throw new Error('Invalid session list')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new Error(`대화 기록을 읽지 못했습니다. 원본은 덮어쓰지 않습니다. 복구용 파일: ${file}.backup`, { cause: error })
    }
  }
  function write(value: unknown) {
    if (!Array.isArray(value) || value.length > 5000) return Promise.reject(new Error('저장할 수 없는 세션 데이터입니다. 최대 5,000개 대화를 보관합니다.'))
    const json = JSON.stringify(value, null, 2)
    if (Buffer.byteLength(json) > 60 * 1024 * 1024) return Promise.reject(new Error('대화 기록이 60MB를 초과했습니다. 기존 기록은 보존됩니다.'))
    writing = writing.catch(() => undefined).then(async () => {
      // Refuse to replace a corrupted original. Keep the preceding valid state
      // in a separate atomic backup before publishing the next snapshot.
      const previous = await read()
      await atomicWriteFile(file + '.backup', JSON.stringify(previous, null, 2))
      await atomicWriteFile(file, json)
    })
    return writing.then(() => true)
  }
  return { read, write }
}
