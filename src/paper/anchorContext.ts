/** Reference positions remain in the user text. Each source is transmitted once. */
export function compactAnchorContext(anchors: ContextAnchor[]) {
  const unique = anchors.filter((anchor, index) => anchors.findIndex(other => other.paperId === anchor.paperId && other.anchorId === anchor.anchorId) === index)
  const evidence = unique.map(anchor => {
    const source = anchor.type === 'figure'
      ? /Caption: ([\s\S]*?)\. Source asset:/.exec(anchor.source)?.[1] ?? ''
      : anchor.source
    return { ref: `@${anchor.label}`, paperId: anchor.paperId, page: anchor.page, type: anchor.type,
      ...(source ? { source: source.slice(0, 4000), ...(source.length > 4000 ? { truncated: true } : {}) } : {}),
      ...(anchor.type === 'figure' ? { imageAttached: true } : {}) }
  })
  return evidence.length ? JSON.stringify({ selectedEvidence: evidence, instruction: 'References in the user question identify these sources, including repeated occurrences. Preserve their order. Truncated sources are partial; do not infer missing details. Figure pixels are attached separately; inspect them directly.' }) : ''
}
