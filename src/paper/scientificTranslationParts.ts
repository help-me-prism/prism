import { validatedScientificSpans, type ScientificSpan } from '../../electron/scientificSource'

export type ScientificTextPart = { text: string; science?: ScientificSpan }
/** Match complete scientific tokens, allowing Korean particles next to them. */
function occurrences(value: string, token: string) {
  const positions: number[] = []; let from = 0
  for (;;) {
    const at = value.indexOf(token, from)
    if (at < 0) return positions
    const before = value.slice(at - 1, at), after = value.slice(at + token.length, at + token.length + 1)
    if (!/[A-Za-z0-9_α-ωΑ-Ω]/u.test(before + after)) positions.push(at)
    from = at + token.length
  }
}

/** Never guess that a flattened legacy token had a subscript. Every occurrence
 * must have verified source geometry and an unambiguous translated counterpart. */
export function scientificTranslationParts(source: string, translated: string, metadata: unknown): ScientificTextPart[] {
  const spans = validatedScientificSpans(source, metadata)
  const groups = new Map<string, ScientificSpan[]>()
  for (const span of spans) groups.set(span.text, [...groups.get(span.text) ?? [], span])
  const placed: Array<{ at: number; span: ScientificSpan }> = []
  for (const [token, group] of groups) {
    const original = occurrences(source, token), target = occurrences(translated, token)
    if (original.length !== group.length || target.length !== group.length || group.some((span, i) => span.start !== original[i])) continue
    target.forEach((at, i) => placed.push({ at, span: group[i] }))
  }
  placed.sort((a, b) => a.at - b.at)
  const parts: ScientificTextPart[] = []; let from = 0
  for (const { at, span } of placed) {
    if (at < from) return [{ text: translated }]
    if (at > from) parts.push({ text: translated.slice(from, at) })
    parts.push({ text: span.text, science: span }); from = at + span.text.length
  }
  if (from < translated.length) parts.push({ text: translated.slice(from) })
  return parts
}
