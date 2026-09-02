const typeLabels: Record<EvidenceAnchorRef['type'], string> = { sentence: '문장', section: '섹션', equation: '수식', table: '표', figure: '피겨', page: '페이지' }

export type EmbeddedEvidence = EvidenceAnchorRef & { paperTitle: string; source: string; sourceHash: string; blockId: string }

function blockId(anchor: EvidenceAnchorRef) {
  const value = `${anchor.paperId}-${anchor.anchorId}`.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 90)
  return `evidence-${value || 'anchor'}`
}

export function evidenceMarkdown(anchor: EvidenceAnchor) {
  const embedded: EmbeddedEvidence = { paperId: anchor.paperId, paperTitle: anchor.paperTitle, anchorId: anchor.anchorId, type: anchor.type, page: anchor.page, label: anchor.label, source: anchor.source, sourceHash: anchor.sourceHash, blockId: blockId(anchor) }
  const metadata = encodeURIComponent(JSON.stringify(embedded))
  const source = anchor.source.replace(/\r?\n/g, '\n').split('\n').map((line) => `> ${line || ' '}`).join('\n')
  const target = `prism://paper/${encodeURIComponent(anchor.paperId)}?anchor=${encodeURIComponent(anchor.anchorId)}&page=${anchor.page}`
  return `> [!evidence] ${typeLabels[anchor.type]} · ${anchor.paperTitle} · p.${anchor.page} · ${anchor.label}\n${source}\n> [PDF 원문 열기](${target})\n<!-- prism-evidence:${metadata} -->\n^${embedded.blockId}`
}

export function embeddedEvidence(markdown: string): EmbeddedEvidence[] {
  const results: EmbeddedEvidence[] = []
  for (const match of markdown.matchAll(/<!--\s*prism-evidence:([^\s]+)\s*-->/g)) {
    try {
      const value = JSON.parse(decodeURIComponent(match[1])) as EmbeddedEvidence
      if (value && typeof value.paperId === 'string' && typeof value.anchorId === 'string' && typeof value.blockId === 'string') results.push(value)
    } catch { /* malformed metadata remains visible in raw Markdown */ }
  }
  return results
}

export function removeEvidence(markdown: string, target: EmbeddedEvidence) {
  const escaped = target.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|\\n\\n)> \\[!evidence\\][^\\n]*(?:\\n>[^\\n]*)*\\n<!--\\s*prism-evidence:[^\\s]+\\s*-->\\n\\^${escaped}(?=\\n\\n|$)`)
  return markdown.replace(pattern, '').replace(/\n{3,}/g, '\n\n')
}

export function replaceEvidence(markdown: string, target: EmbeddedEvidence, replacement: EvidenceAnchor) {
  const escaped = target.blockId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`> \\[!evidence\\][^\\n]*(?:\\n>[^\\n]*)*\\n<!--\\s*prism-evidence:[^\\s]+\\s*-->\\n\\^${escaped}`)
  return markdown.replace(pattern, evidenceMarkdown(replacement))
}

export function evidenceTypeLabel(type: EvidenceAnchorRef['type']) { return typeLabels[type] }
