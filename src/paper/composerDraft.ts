export type ComposerOwner = { sessionId: string; revision: number }

/** An async send can restore only the exact composer it consumed. */
export function composerLease(owner: ComposerOwner, current: () => ComposerOwner) {
  return () => {
    const latest = current()
    return latest.sessionId === owner.sessionId && latest.revision === owner.revision
  }
}
