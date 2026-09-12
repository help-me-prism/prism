/** A thread resumed in this app-server already owns its writer until that server exits. */
export class LoadedThreads {
  private loaded = new Set<string>()
  private pending = new Map<string, Promise<void>>()
  add(id: string) { this.loaded.add(id) }
  clear() { this.loaded.clear(); this.pending.clear() }
  async ensure(id: string, resume: () => Promise<unknown>) {
    if (this.loaded.has(id)) return
    const existing = this.pending.get(id)
    if (existing) return existing
    const work = Promise.resolve().then(resume).then(() => { this.loaded.add(id) })
    this.pending.set(id, work)
    try { await work } finally { if (this.pending.get(id) === work) this.pending.delete(id) }
  }
}
