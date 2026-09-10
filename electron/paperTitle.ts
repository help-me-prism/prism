export type PaperTitleRequest = { paperId: string; title: string; expectedTitle: string; libraryPath: string }
type RecordBase = { arxivId: string; title: string }
export async function updatePaperTitleRecord<T extends RecordBase>(input: PaperTitleRequest, deps: {
  currentLibrary: () => Promise<string | undefined>; read: () => Promise<T[]>; commit: (records: T[]) => Promise<void>;
  propagate: (paper: T, oldTitle: string) => Promise<string[]>; notify: (records: T[]) => void;
}) {
  if (!input || typeof input.paperId !== 'string' || typeof input.title !== 'string' || typeof input.expectedTitle !== 'string' || typeof input.libraryPath !== 'string') throw new Error('논문 제목 요청이 올바르지 않습니다.')
  const title = input.title.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title || title.length > 1000) throw new Error('논문 제목은 1–1000자로 입력해 주세요.')
  const checkOwner = async () => { if (await deps.currentLibrary() !== input.libraryPath) throw new Error('노트 볼트가 변경됐습니다. 현재 볼트에서 다시 시도해 주세요.') }
  await checkOwner()
  const records = await deps.read(); const old = records.find(paper => paper.arxivId === input.paperId)
  if (!old) throw new Error('논문을 찾을 수 없습니다.')
  if (old.title !== input.expectedTitle && old.title !== title) throw new Error('다른 곳에서 논문 제목이 변경됐습니다. 최신 제목을 확인해 주세요.')
  const paper = { ...old, title }; const next = records.map(item => item.arxivId === paper.arxivId ? paper : item)
  await checkOwner()
  if (old.title !== title) await deps.commit(next)
  // Repeating a successful request can repair its secondary copies without overwriting a newer title.
  const warnings = await deps.propagate(paper, input.expectedTitle)
  if (await deps.currentLibrary() === input.libraryPath) deps.notify(next)
  return { paper, warnings }
}

/** Conservative editing: refuse unfamiliar YAML rather than reserialize a user's document. */
export function renamedPaperNote(content: string, oldTitle: string, title: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return undefined
  const eol = content.includes('\r\n') ? '\r\n' : '\n'; const lines = match[1].split(/\r?\n/)
  const scalar = (raw: string): string | undefined => { try { const value = JSON.parse(raw); return typeof value === 'string' ? value : undefined } catch { if (/^'[^\n]*'$/.test(raw)) return raw.slice(1, -1).replace(/''/g, "'"); if (raw && !/[#\[\]{}>|&*!]/.test(raw)) return raw; return undefined } }
  const titleLines = lines.map((line, index) => /^title:/.test(line) ? index : -1).filter(index => index >= 0)
  if (titleLines.length !== 1) return undefined
  const index = titleLines[0]; const current = scalar(lines[index].slice(6).trim())
  if (current !== oldTitle && current !== title) return undefined
  if (oldTitle === title) return content
  const aliasLines = lines.map((line, i) => /^aliases:/.test(line) ? i : -1).filter(i => i >= 0)
  if (aliasLines.length > 1) return undefined
  if (!aliasLines.length) lines.push(`aliases: [${JSON.stringify(oldTitle)}]`)
  else {
    const start = aliasLines[0]; const raw = lines[start].slice(8).trim(); let aliases: string[]; let end = start + 1
    if (raw.startsWith('[')) { try { aliases = JSON.parse(raw); if (!Array.isArray(aliases) || aliases.some(item => typeof item !== 'string')) return undefined } catch { return undefined } }
    else if (raw) { const value = scalar(raw); if (value === undefined) return undefined; aliases = [value] }
    else { aliases = []; while (end < lines.length && /^\s+-\s/.test(lines[end])) { const value = scalar(lines[end].replace(/^\s+-\s*/, '')); if (value === undefined) return undefined; aliases.push(value); end++ } }
    if (!aliases.includes(oldTitle)) aliases.push(oldTitle)
    lines.splice(start, end - start, `aliases: ${JSON.stringify(aliases)}`)
  }
  // Locate again because a block aliases field may precede title.
  lines[lines.findIndex(line => /^title:/.test(line))] = `title: ${JSON.stringify(title)}`
  let body = content.slice(match[0].length)
  const heading = body.match(/^(?:\r?\n)*(#[^\r\n]*)(?:\r?\n|$)/)
  if (heading?.[1] === `# ${oldTitle}`) { const at = body.indexOf(heading[1]); body = body.slice(0, at) + `# ${title}` + body.slice(at + heading[1].length) }
  return `---${eol}${lines.join(eol)}${eol}---${match[0].endsWith('\n') ? eol : ''}${body}`
}
