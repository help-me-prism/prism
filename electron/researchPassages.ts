export type ResearchPassage = { kind: 'prose' | 'summary' | 'evidence' | 'ai-answer' | 'abstract'; text: string }
/** Include in derived index revision: old plain-text vectors are not interchangeable. */
export const researchPassagesVersion = 1

const navigationSections = new Set(['sources', 'relations', 'asked', 'confusion'])
const placeholders = new Set(['아직 없음', '논문 본문과 초록을 아직 읽지 못했습니다.', '이 논문에 대해 물어본 것이 아직 없습니다.', '리더에서 문장을 태그하면 여기에 쌓입니다.'])
function plain(line: string) {
  return line.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target, alias) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/^[ \t]*[-*+]\s+/, '')
    .replace(/\s+/g, ' ').trim()
}

/** Semantic passages only. Titles/questions/navigation remain available to lexical search.
 * This does not mutate notes or certify that an AI answer/evidence quote is scientifically true.
 */
export function researchPassages(markdown: string): ResearchPassage[] {
  let source = markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  // Only recognize complete app-owned regions. An unfinished marker must not swallow user prose.
  source = source.replace(/<!--\s*prism:auto\s+([a-z-]+)\s*-->([\s\S]*?)<!--\s*\/prism:auto\s+\1\s*-->/g,
    (_whole, section: string, body: string) => navigationSections.has(section) ? '\n' : `\n<!-- research-section:${section} -->\n${body}\n<!-- /research-section -->\n`)
  const result: ResearchPassage[] = []
  let kind: ResearchPassage['kind'] = 'prose'
  let generated = ''; let callout = ''; let question = false; let comment = false
  let lines: string[] = []
  const flush = () => { const text = lines.join(' ').replace(/\s+/g, ' ').trim(); if (text) result.push({ kind, text }); lines = [] }
  for (const original of source.split(/\r?\n/)) {
    const section = original.match(/^<!-- research-section:([a-z-]+) -->$/)
    if (section || original === '<!-- /research-section -->') {
      flush(); generated = section?.[1] ?? ''; callout = ''; question = false
      kind = generated === 'overview' ? 'summary' : generated === 'focus' ? 'evidence' : 'prose'; continue
    }
    // Metadata can span lines. It is never research prose.
    let raw = original
    if (comment) { const end = raw.indexOf('-->'); if (end < 0) continue; raw = raw.slice(end + 3); comment = false }
    raw = raw.replace(/<!--[\s\S]*?-->/g, '')
    const start = raw.indexOf('<!--'); if (start >= 0) { raw = raw.slice(0, start); comment = true }
    const quoted = /^\s*>/.test(raw)
    const header = raw.match(/^\s*>\s*\[!([^\]]+)\][+-]?.*$/)
    if (header) {
      flush(); callout = header[1].toLowerCase(); question = false
      kind = callout === 'ai' ? 'ai-answer' : callout === 'evidence' ? 'evidence' : callout === 'abstract' ? 'abstract' : 'prose'; continue
    }
    if (!quoted && raw.trim() && callout) { flush(); callout = ''; question = false; kind = generated === 'overview' ? 'summary' : generated === 'focus' ? 'evidence' : 'prose' }
    raw = raw.replace(/^\s*>\s?/, '')
    if (!raw.trim()) { flush(); question = false; continue }
    if (/^\s*#{1,6}\s/.test(raw) || /^\s*\^[\w-]+\s*$/.test(raw) || /^\s*(?:---+|```.*|~~~.*)\s*$/.test(raw)) { flush(); continue }
    if (callout === 'ai' && /^\s*(?:\*\*)?Q:(?:\*\*)?\s*/.test(raw)) { flush(); question = true; continue }
    if (question) continue
    if (callout === 'ai' && /^\s*참조:\s*/.test(raw)) continue
    // A link by itself navigates; a sentence containing a source link remains useful prose.
    if (/^\s*(?:[-*+]\s*)?(?:\[[^\]]+\]\(prism:\/\/[^)]+\)|\[\[[^\]]+\]\])\s*$/.test(raw)) continue
    const text = plain(raw)
    if (generated && (placeholders.has(text.replace(/^_(.*)_$/, '$1')) || /^근거\d+\s*\(p\.\d+\)$/.test(text))) continue
    if (text) lines.push(text)
  }
  flush()
  return result
}
