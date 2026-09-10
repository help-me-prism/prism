/** Link only after creation, using the new note's current revision. A skipped or
 * failed connection never asks the caller to create that note a second time. */
export async function linkCreatedNote(sourceId: string, targetId: string, current: () => boolean, read: (id: string) => Promise<{ revision: string }>, create: (request: { sourceId: string; targetId: string; type: 'related'; creator: 'user'; expectedRevision: string }) => Promise<{ saved: boolean }>) {
  if (!current()) return 'stale' as const
  const snapshot = await read(sourceId)
  if (!current()) return 'stale' as const
  const result = await create({ sourceId, targetId, type: 'related', creator: 'user', expectedRevision: snapshot.revision })
  if (!result.saved) throw new Error('새 노트가 외부에서 변경되어 논문과 연결하지 못했습니다.')
  return 'linked' as const
}
