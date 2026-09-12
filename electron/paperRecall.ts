import { mineHeadings, mineMarkers, type MineSection } from './noteContract.js'

export const recallSections = ['restate', 'unresolved', 'apply'] as const
export type RecallSection = typeof recallSections[number]
export type PaperRecall = Record<RecallSection, string>

// Keep source offsets while excluding fenced examples and frontmatter from section lookup.
function sectionSource(content: string) {
  let fence: { char: string; size: number } | undefined
  let frontmatter = /^---\r?\n/.test(content)
  let first = true
  return content.replace(/[^\n]*(?:\n|$)/g, line => {
    const wasFirst = first; first = false
    if (frontmatter) {
      if (!wasFirst && /^---\s*$/.test(line)) frontmatter = false
      return line.replace(/[^\r\n]/g, ' ')
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.size && !line.slice(marker[0].length).trim()) fence = undefined
      return line.replace(/[^\r\n]/g, ' ')
    }
    if (marker) { fence = { char: marker[1][0], size: marker[1].length }; return line.replace(/[^\r\n]/g, ' ') }
    return line
  })
}

function fieldRegion(content: string, section: MineSection) {
  const source = sectionSource(content)
  const { open, close } = mineMarkers(section)
  const starts = [...source.matchAll(new RegExp(`^${open}\\r?$`, 'gm'))]
  const ends = [...source.matchAll(new RegExp(`^${close}\\r?$`, 'gm'))]
  if (starts.length || ends.length) {
    if (starts.length !== 1 || ends.length !== 1 || starts[0].index! >= ends[0].index!) throw new Error('이 항목의 구간이 겹치거나 닫히지 않았습니다. 전체 노트에서 확인해 주세요.')
    const from = starts[0].index! + open.length, to = ends[0].index!
    if (/<!--\s*\/?prism:(?:mine|auto)\b/.test(source.slice(from, to))) throw new Error('노트 항목이 서로 겹쳐 있습니다. 전체 노트에서 확인해 주세요.')
    return { from, to, marked: true }
  }
  // Older handwritten sections remain in place when edited through the recall form.
  const headings = [...source.matchAll(new RegExp(`^##[ \\t]+${mineHeadings[section]}[ \\t]*\\r?$`, 'gm'))]
  if (headings.length > 1) throw new Error('같은 제목의 항목이 여러 개 있습니다. 전체 노트에서 확인해 주세요.')
  if (!headings.length) return undefined
  const from = headings[0].index! + headings[0][0].length
  const next = source.slice(from).search(/^#{1,2}[ \t]+/m)
  return { from, to: next < 0 ? content.length : from + next, marked: false }
}

export function readRecallField(content: string, section: RecallSection) {
  const region = fieldRegion(content, section)
  if (!region) return ''
  const text = content.slice(region.from, region.to)
  return region.marked ? text.replace(/^\r?\n/, '').replace(/\r?\n$/, '') : text.trim()
}

/** Edits only the chosen personal field; never rebuilds a note from its preview. */
export function writeRecallField(content: string, section: RecallSection, value: string) {
  if (/<!--\s*\/?prism:(?:mine|auto)\b/.test(value)) throw new Error('노트 구간 표시는 전체 노트에서 편집해 주세요.')
  const region = fieldRegion(content, section)
  if (!region && !value.trim()) return content
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  const { open, close } = mineMarkers(section)
  const text = value.replace(/\r?\n/g, newline)
  if (region?.marked) return `${content.slice(0, region.from)}${newline}${text}${newline}${content.slice(region.to)}`
  const body = `${newline}${newline}${open}${newline}${text}${newline}${close}${newline}${newline}`
  if (region) return `${content.slice(0, region.from)}${body}${content.slice(region.to)}`
  return `${content}${content.endsWith(newline) ? newline : newline + newline}## ${mineHeadings[section]}${body}`
}

export function paperRecall(content: string): PaperRecall {
  const result: PaperRecall = { restate: '', unresolved: '', apply: '' }
  for (const section of recallSections) {
    try { result[section] = readRecallField(content, section) } catch { /* Ambiguous sections remain available in the full note. */ }
  }
  return result
}

export function recallPreview(value: string) {
  return value.replace(/<!--[\s\S]*?-->/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => label ?? target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*(?:#{1,6}|[-*>])\s+/gm, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().slice(0, 260)
}
