import type { EvidenceAnchor } from './evidence.js'

/** Whole original prose only: this is a bounded sample, never a representation of a full read. */
export function sampleResearchEvidence(anchors: EvidenceAnchor[], note: string, maxItems = 24, maxChars = 12_000) {
  const headings = anchors.filter(anchor => /^(?:references|bibliography|literature cited|참고문헌|appendix|appendices|supporting information|supplement)\b/i.test(anchor.source.trim().replace(/^\d+[.\s]+/, '')) && anchor.source.length < 100).sort((a, b) => a.page - b.page)
  const inBibliography = (anchor: EvidenceAnchor) => {
    let bibliography = false
    for (const heading of headings) {
      if (heading.paperId !== anchor.paperId || heading.page > anchor.page) continue
      bibliography = /^(?:references|bibliography|literature cited|참고문헌)$/i.test(heading.source.trim().replace(/^\d+[.\s]+/, ''))
    }
    return bibliography
  }
  const prose = anchors.filter(anchor => !inBibliography(anchor) && anchor.type === 'sentence' && anchor.source.length >= 60 && anchor.source.length <= 1800
    && !/[\u0000-\u0008\u000b-\u001f\ufffd]/.test(anchor.source)
    && !/^\s*(?:this is an open access|copyright|funding|competing interests|data availability|the funders|all relevant data|this work was supported|received:|accepted:)/i.test(anchor.source)
    && !/^\s*(?:fig(?:ure)?\.?|table)\s*\d/i.test(anchor.source)
    && !/[=∑∫√]|\\(?:frac|begin|sum)\b/.test(anchor.source)
    && (anchor.source.match(/[\p{L}]/gu)?.length ?? 0) / anchor.source.length > .55)
    .sort((a, b) => a.page - b.page)
  const selected: Array<{ id: string; anchor: EvidenceAnchor; line: string }> = []
  const seen = new Set<string>(); let chars = 0
  const add = (anchor: EvidenceAnchor) => {
    const id = `pdf-${encodeURIComponent(anchor.paperId)}-${encodeURIComponent(anchor.anchorId)}`
    const line = `EVIDENCE[${id}] ${anchor.label} p.${anchor.page}: ${anchor.source}`
    if (selected.length >= maxItems || chars + line.length + 1 > maxChars || seen.has(anchor.source)) return
    selected.push({ id, anchor, line }); seen.add(anchor.source); chars += line.length + 1
  }
  // Explicit note references win, but cannot consume the entire cross-paper sample budget.
  const referenced = prose.filter(anchor => note.includes(`"anchorId":"${anchor.anchorId}"`) || note.includes(encodeURIComponent(`"anchorId":"${anchor.anchorId}"`)) || note.includes(`anchor=${encodeURIComponent(anchor.anchorId)}`))
  referenced.slice(0, 6).forEach(add)
  // Result-bearing prose and conclusions help when section extraction labels the whole PDF '본문'.
  prose.filter(anchor => /\b(?:results? (?:show(?:s|ed|ing)?|indicat(?:e[sd]?|ing)|demonstrat(?:e[sd]?|ing))|we (?:found|find|observed|conclude)|in conclusion|our findings|significantly|increased|decreased)\b|결론|결과.*(?:보였|나타|확인)/i.test(anchor.source)).slice(-6).forEach(add)
  const pages = [...new Set(prose.map(anchor => anchor.page))]
  const pageSlots = Math.min(pages.length, Math.max(1, maxItems - selected.length))
  for (let i = 0; i < pageSlots; i += 1) {
    const page = pages[Math.round(i * (pages.length - 1) / Math.max(1, pageSlots - 1))]
    const candidates = prose.filter(anchor => anchor.page === page && !seen.has(anchor.source))
    if (candidates.length) add(candidates[Math.floor(candidates.length / 2)])
  }
  for (let i = 0; i < prose.length && selected.length < maxItems; i += 1) add(prose[i])
  return selected
}
