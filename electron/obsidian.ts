import path from 'node:path'

export type ObsidianOpenRequest = { nodeId: string; heading?: string; blockId?: string }

export function buildObsidianOpenUri(libraryPath: string, relativePath: string, target: Pick<ObsidianOpenRequest, 'heading' | 'blockId'> = {}, platform: NodeJS.Platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (target.heading !== undefined && target.blockId !== undefined) throw new Error('Obsidian 위치는 제목 또는 블록 중 하나만 지정할 수 있습니다.')
  if (target.heading !== undefined && (typeof target.heading !== 'string' || !target.heading.trim() || target.heading.length > 300 || /[\r\n]/.test(target.heading))) throw new Error('Obsidian 제목 위치가 올바르지 않습니다.')
  if (target.blockId !== undefined && (typeof target.blockId !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(target.blockId))) throw new Error('Obsidian 블록 위치가 올바르지 않습니다.')
  if (typeof relativePath !== 'string' || !relativePath.endsWith('.md') || relativePath.includes('\\') || pathApi.isAbsolute(relativePath) || relativePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Vault 상대 경로가 올바르지 않습니다.')

  if (!pathApi.isAbsolute(libraryPath)) throw new Error('Vault 경로가 올바르지 않습니다.')
  const absolutePath = pathApi.resolve(libraryPath, ...relativePath.split('/'))
  const resolvedRelative = pathApi.relative(pathApi.resolve(libraryPath), absolutePath)
  if (!resolvedRelative || resolvedRelative.startsWith(`..${pathApi.sep}`) || resolvedRelative === '..' || pathApi.isAbsolute(resolvedRelative)) throw new Error('Vault 밖의 파일은 열 수 없습니다.')

  const fragment = target.heading !== undefined ? `#${target.heading.trim()}` : target.blockId !== undefined ? `#^${target.blockId}` : ''
  return `obsidian://open?path=${encodeURIComponent(`${absolutePath}${fragment}`)}`
}
