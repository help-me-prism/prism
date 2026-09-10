/** Resolve an exact Obsidian block marker without confusing code examples or duplicates. */
export function noteBlockPosition(content: string, blockId: string): number | undefined {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(blockId)) return undefined
  const lines = [...content.matchAll(/[^\n]*(?:\n|$)/g)].filter(match => match[0])
  let fence: string | undefined; const matches: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i][0].trim(); const marker = /^(`{3,}|~{3,})/.exec(text)?.[1]
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined; continue }
    if (!fence && text === `^${blockId}`) matches.push(i)
  }
  if (matches.length !== 1) return undefined
  let start = matches[0]
  while (start > 0 && !lines[start - 1][0].trim()) start--
  // Legacy saves placed the metadata immediately between the callout and ID.
  if (start && /^<!--\s*prism-ai-answer:/.test(lines[start - 1][0].trim())) start--
  while (start > 0 && !lines[start - 1][0].trim()) start--
  while (start > 0 && /^\s*>/.test(lines[start - 1][0])) start--
  for (let i = start; i < matches[0]; i++) {
    const text = lines[i][0].trim()
    if (/^>\s*\[!/.test(text) || /^>\s*\*\*Q:\*\*/.test(text) || /^>\s*$/.test(text)) continue
    if (/^>/.test(text)) return lines[i].index! + lines[i][0].indexOf('>') + 1
  }
  return lines[start].index
}
