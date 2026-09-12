export type TranslationStatus<S = unknown> = { arxivId: string; revision: number; running: boolean; completed: number; total: number; segments?: S[]; warning?: string; message?: string }
export class TranslationStatusStore<S> {
  private states = new Map<string, TranslationStatus<S>>()
  private revision = 0
  get(id: string) { return this.states.get(id) ?? null }
  report(channel: string, event: { arxivId: string; completedSegments?: number; totalSegments?: number; segments?: S[]; warning?: string; message?: string }) {
    const previous = this.get(event.arxivId)
    const value = { ...previous, warning: undefined, message: undefined, ...event, revision: ++this.revision, running: channel === 'translation:progress', completed: event.completedSegments ?? previous?.completed ?? 0, total: event.totalSegments ?? previous?.total ?? 0 }
    this.states.set(event.arxivId, value)
    return value
  }
}
