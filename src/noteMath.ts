export type NoteMath = { from: number; to: number; source: string; display: boolean; delimiter: number }
/** Explicit Markdown/TeX math; code, links and escaped currency stay literal. */
export function noteMathRanges(text: string): NoteMath[] {
  const result: NoteMath[] = []
  const tokens = /(`+)[\s\S]*?\1|\[[^\]\n]*\]\([^\n)]*\)|\\\$|(?<!\\)\$\$([\s\S]*?)(?<!\\)\$\$|\\\[([\s\S]*?)\\\]|\\\(([^\n]*?)\\\)|(?<![\\$])\$(?!\$)([^$\n]+)(?<!\\)\$(?!\$)/g
  for (const match of text.matchAll(tokens)) {
    const source = match[2] ?? match[3] ?? match[4] ?? match[5]
    if (!source?.trim() || source.length > 20_000 || (match[5] !== undefined && source !== source.trim())) continue
    result.push({ from: match.index!, to: match.index! + match[0].length, source: source.trim(), display: match[2] !== undefined || match[3] !== undefined, delimiter: match[5] !== undefined ? 1 : 2 })
  }
  return result
}
