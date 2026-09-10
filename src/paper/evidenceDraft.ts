type DraftContent = { memo: string; concept: string }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
const prefix = 'prism.evidence-draft.v1:'

export function readEvidenceDraft(storage: Storage, key: string): DraftContent {
  const raw = storage.getItem(prefix + key)
  if (!raw) return { memo: '', concept: '' }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('memo' in value) || !('concept' in value)
    || typeof value.memo !== 'string' || typeof value.concept !== 'string') throw new Error('Invalid draft')
  return { memo: value.memo, concept: value.concept }
}

export function writeEvidenceDraft(storage: Storage, key: string, draft: DraftContent) {
  if (!draft.memo && !draft.concept) storage.removeItem(prefix + key)
  else storage.setItem(prefix + key, JSON.stringify({ memo: draft.memo, concept: draft.concept }))
}
