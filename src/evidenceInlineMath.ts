import katex from 'katex'

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const inlineTokens = /(`+)[\s\S]*?\1|\[[^\]\n]*\]\([^\n)]*\)|\\\$|\$\$[\s\S]*?\$\$|\$([^$\n]+)\$/g

export function evidenceInlineMathParts(source: string): Array<{ text: string; math?: string }> {
  const parts: Array<{ text: string; math?: string }> = []
  let from = 0
  for (const match of source.matchAll(inlineTokens)) {
    if (match.index! > from) parts.push({ text: source.slice(from, match.index) })
    parts.push(match[2] && match[2] === match[2].trim() && match[2].length <= 1000 ? { text: match[0], math: match[2] } : { text: match[0] })
    from = match.index! + match[0].length
  }
  if (from < source.length) parts.push({ text: source.slice(from) })
  return parts
}
/** Evidence is plain quoted text, with explicit single-dollar math only.
 * No Markdown/HTML links are activated inside the clickable source card. */
export function evidenceInlineMathHtml(source: string): string {
  // Protect code, existing Markdown links, escaped dollars, and display math.
  let result = ''; let from = 0
  for (const match of source.matchAll(inlineTokens)) {
    result += escape(source.slice(from, match.index))
    let rendered = escape(match[0])
    const math = match[2]
    if (math && math === math.trim() && math.length <= 1000) {
      try { rendered = katex.renderToString(math, { displayMode: false, trust: false, strict: 'error', throwOnError: true, maxExpand: 100, maxSize: 10 }) }
      catch { /* Unsupported input stays literal, never becomes raw HTML. */ }
    }
    result += rendered; from = match.index! + match[0].length
  }
  return result + escape(source.slice(from))
}
