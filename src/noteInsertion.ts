/** A newly opened editor starts before its hidden frontmatter/body boundary.
 * Default toolbar insertions go after the title; an explicit body caret stays put.
 */
export function noteBlockInsertionPosition(content: string, caret: number) {
  const bodyStart = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0
  if (caret > bodyStart) return Math.min(content.length, caret)
  const title = content.slice(bodyStart).match(/^\s*# [^\r\n]+(?:\r?\n|$)/)
  return bodyStart + (title?.[0].length ?? 0)
}
