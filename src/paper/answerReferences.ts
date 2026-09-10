type ReferenceAnchor = { paperId: string; anchorId: string; label: string }
type ReferenceMessage<A extends ReferenceAnchor> = { id: string; anchors?: A[] }
const referencePattern = /\[?@((?:문장|섹션|근거|수식|표|피겨|페이지)\d+(?:-[A-Za-z0-9]+)?)\]?/g

/** Resolve only evidence available at this answer's time. A reused label must never
 * silently choose between papers. The backend still receives only known anchors. */
export function answerReferenceAnchors<A extends ReferenceAnchor>(messages: ReferenceMessage<A>[], answerId: string): A[] {
  const index = messages.findIndex(message => message.id === answerId)
  if (index < 0) return []
  const labels = new Map<string, Map<string, A>>()
  for (const message of messages.slice(0, index + 1)) for (const anchor of message.anchors ?? []) {
    if (!anchor.paperId || !anchor.anchorId) continue
    const identities = labels.get(anchor.label) ?? new Map<string, A>()
    identities.set(JSON.stringify([anchor.paperId, anchor.anchorId]), anchor)
    labels.set(anchor.label, identities)
  }
  return [...labels.values()].filter(identities => identities.size === 1).map(identities => [...identities.values()][0])
}

/** Optional citation selection for save/export; the complete resolver above also
 * supplies historical clickable anchors to the rendered assistant message. */
export function answerReferences<A extends ReferenceAnchor>(messages: ReferenceMessage<A>[], answer: { id: string; text: string }): A[] {
  const labels = new Map(answerReferenceAnchors(messages, answer.id).map(anchor => [anchor.label, anchor]))
  const result: A[] = []; const seen = new Set<string>()
  // Citation-looking examples in code/math are not source assertions. Match the
  // same protected spans as chatCaptureProvenance, including inline/backtick code.
  const prose = answer.text.split(/(`{3,}[^\n]*\n[\s\S]*?`{3,}|~~~[^\n]*\n[\s\S]*?~~~|`+[^`\n]*`+|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g)
  for (let part = 0; part < prose.length; part += 2) for (const match of prose[part].matchAll(referencePattern)) {
    const anchor = labels.get(match[1])
    if (!anchor) continue
    const identity = JSON.stringify([anchor.paperId, anchor.anchorId])
    if (!seen.has(identity)) { seen.add(identity); result.push(anchor) }
  }
  return result
}
