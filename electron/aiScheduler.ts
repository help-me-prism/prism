/** Background CLI calls share one FIFO per provider across papers and task types.
 * Interactive chat has its own transport and never waits in this queue. */
export function createAiScheduler(limit = 3) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid AI concurrency limit')
  type Job = { start: () => void; cancel: () => void; signal?: AbortSignal }
  const providers = new Map<string, { active: number; queue: Job[] }>()
  return function schedule<T>(provider: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const state = providers.get(provider) ?? { active: 0, queue: [] }
      providers.set(provider, state)
      const drain = () => {
        while (state.active < limit && state.queue.length) state.queue.shift()!.start()
        if (!state.active && !state.queue.length) providers.delete(provider)
      }
      const job: Job = {
        signal,
        cancel: () => {
          const index = state.queue.indexOf(job)
          if (index < 0) return
          state.queue.splice(index, 1)
          signal?.removeEventListener('abort', job.cancel)
          reject(signal?.reason ?? new Error('AI 작업이 취소되었습니다.'))
          drain()
        },
        start: () => {
          signal?.removeEventListener('abort', job.cancel)
          state.active++
          // Deferring work also catches synchronous errors and releases its slot.
          Promise.resolve().then(() => { signal?.throwIfAborted(); return work() })
            .then(resolve, reject).finally(() => { state.active--; drain() })
        },
      }
      state.queue.push(job)
      signal?.addEventListener('abort', job.cancel, { once: true })
      if (signal?.aborted) job.cancel()
      else drain()
    })
  }
}
