import { promises as fs } from 'node:fs'

export async function canonicalChatScope(value: string | null | undefined) {
  return value ? fs.realpath(value) : null
}

export async function assertChatScope(expected: string | null | undefined, actual: string | undefined, previous?: { libraryPath?: string | null; messages?: unknown[]; providerThreadId?: string }) {
  if (expected === undefined) throw new Error('질문의 보관함 정보를 확인하지 못했습니다. 앱을 다시 열어 주세요.')
  const scope = await canonicalChatScope(actual)
  if (await canonicalChatScope(expected) !== scope) throw new Error('질문 준비 중 보관함이 변경되었습니다. 현재 보관함에서 다시 보내 주세요.')
  if (previous && (previous.messages?.length || previous.providerThreadId)) {
    if (previous.libraryPath === undefined) throw new Error('이전 버전 대화는 보관함 정보가 없습니다. 기록은 보존됩니다. 현재 보관함에서 새 대화를 시작해 주세요.')
    if (await canonicalChatScope(previous.libraryPath) !== scope) throw new Error('이 대화는 다른 보관함에서 시작했습니다. 현재 보관함에서 새 대화를 시작해 주세요.')
  }
  return scope
}
