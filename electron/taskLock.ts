const running = new Set<string>()
export async function withTaskLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (running.has(key)) throw new Error('같은 노트의 AI 작업이 이미 진행 중입니다. 완료된 뒤 다시 실행해 주세요.')
  running.add(key)
  try { return await work() }
  finally { running.delete(key) }
}
