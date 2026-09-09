const labels: Record<string, string> = { sentence: '문장', section: '섹션', equation: '수식', table: '표', figure: '피겨', page: '페이지' }
/** Presentation only: never replace the anchor's stable identity or prompt label. */
export function composerEvidenceLabel(anchor: { label: string; type: string; page: number; source: string; paperTitle?: string }) {
  const kind = labels[anchor.type] ?? '근거'
  const location = Number.isInteger(anchor.page) && anchor.page > 0 ? `${anchor.page}쪽 · ${kind}` : kind
  const source = anchor.source.replace(/\s+/g, ' ').trim()
  // Image anchors carry a local file path and crop coordinates for the model.
  // That transport description is not a useful preview for the reader.
  const savedImage = anchor.type === 'figure' && /^(?:Saved figure image:|Matched LaTeX figure \d+\. Caption:)/.test(source)
  const caption = savedImage ? source.match(/^Matched LaTeX figure \d+\. Caption: (.*?)\. Source asset:/)?.[1] : undefined
  const excerpt = savedImage ? caption && caption !== 'unknown' ? caption : '선택한 피겨 영역' : source
  return { location, excerpt, description: [anchor.label, location, anchor.paperTitle?.trim(), excerpt].filter(Boolean).join('\n') }
}
