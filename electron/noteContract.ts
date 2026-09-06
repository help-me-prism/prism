/**
 * What a note is made of, and who owns each part. This table is the whole policy: three layers, and one
 * invariant that keeps them apart.
 *
 * - `machine` costs nothing and is rewritten every time the note is looked at. Links, relations, chat — the
 *   vault already holds the answer in words, and nobody has to judge anything to pull it out.
 * - `model` needs a model to say anything at all, so it waits until one is asked for and is left alone
 *   otherwise. A missing CLI today does not make yesterday's definition wrong.
 * - `mine` is the researcher's. It cannot be derived from the vault because it is not in the vault: why they
 *   read the paper, what they still do not understand, what they would use it for. Everything else here can
 *   be regenerated; this is the only part that is gone for good if it is lost.
 *
 * The separation is not a convention that generated text is asked to respect. `withoutAutoSections` strips
 * exactly the regions automation is allowed to touch, and every automatic write asserts that what remains is
 * unchanged — so a bug that reaches the researcher's writing fails loudly instead of quietly eating it.
 */
export type AutoSection = 'overview' | 'confusion' | 'focus' | 'sources' | 'support' | 'against' | 'answers' | 'asked' | 'definition' | 'stake'
export type MineSection = 'unresolved' | 'apply' | 'restate' | 'belief' | 'matters'

export const autoHeadings: Record<AutoSection, string> = {
  overview: '한눈에', confusion: '내가 헷갈린 것', focus: '내가 주목한 것', sources: '어디서 나왔나',
  support: '지지 근거', against: '반박', answers: '지금까지 나온 답', asked: '대화에서 물어본 것',
  definition: '정의', stake: '무엇에 달려 있나',
}

/**
 * Two prompts per note at most. Four headings under one paper is a form again, and the reason for naming
 * these separately rather than keeping one "내 생각" bucket is that an empty box asking a specific question
 * is answerable, while an empty box labelled "thoughts" is not.
 */
export const mineHeadings: Record<MineSection, string> = {
  unresolved: '아직 모르겠는 것', apply: '내 연구에 쓸 곳', restate: '내 말로', belief: '믿는 정도와 이유', matters: '왜 중요한가',
}
/** What the editor asks when the section is empty. Never written to the file; it is a prompt, not content. */
export const minePrompts: Record<MineSection, string> = {
  unresolved: '물어봤는데도 아직 안 풀린 게 있나요?',
  apply: '이걸 지금 하는 연구에 어떻게 쓸 수 있을까요?',
  restate: '모델이 쓴 정의 말고, 당신 말로 한 줄.',
  belief: '얼마나 믿나요? 그리고 왜?',
  matters: '이 질문이 왜 중요한가요?',
}

export type NoteSectionRule = {
  section: AutoSection
  /**
   * `machine` costs nothing and runs on every open. `model` costs a call and only runs when one is asked for.
   * `chat` belongs to the conversation: the model writing the answer decides, in the same turn, that something
   * is worth keeping and says so through the `remember` tool — no second inference, which is how every
   * assistant that has a memory does it. The deterministic extraction that used to guess at these from
   * question marks and word stems is kept only as a floor, seeding a section that is still empty so a
   * researcher with no CLI configured is not left with nothing.
   */
  by: 'machine' | 'model' | 'chat'
  relations?: { types: string[]; direction?: 'incoming' | 'outgoing' }
}

export const noteAutomation: Partial<Record<string, NoteSectionRule[]>> = {
  paper: [
    { section: 'overview', by: 'machine' },
    { section: 'confusion', by: 'chat' },
    { section: 'focus', by: 'machine' },
  ],
  concept: [
    { section: 'definition', by: 'model' },
    { section: 'sources', by: 'machine' },
    { section: 'asked', by: 'chat' },
  ],
  claim: [
    { section: 'sources', by: 'machine' },
    { section: 'support', by: 'machine', relations: { types: ['supports', 'evidence_for'] } },
    { section: 'against', by: 'machine', relations: { types: ['contradicts'] } },
    { section: 'asked', by: 'chat' },
    { section: 'stake', by: 'model' },
  ],
  question: [
    { section: 'sources', by: 'machine' },
    { section: 'answers', by: 'machine', relations: { types: ['answers'] } },
    { section: 'asked', by: 'chat' },
  ],
}

export const noteMine: Partial<Record<string, MineSection[]>> = {
  paper: ['unresolved', 'apply'],
  concept: ['restate'],
  claim: ['belief'],
  question: ['matters'],
}

/** Sections older notes carry that are the researcher's too, and were never marked as anything. */
export const legacyMineHeadings = ['내 생각', '메모']

/**
 * The title the `remember` tool carries. Codex asks the client to approve an MCP tool call by title rather
 * than by name, so this is what Prism recognises its own memory tool by — one constant instead of the same
 * string written twice and drifting apart.
 */
export const rememberToolTitle = 'Keep something in a note'

/**
 * A tool the model never reaches for is a tool that does not exist. Left to itself it answers the question
 * and moves on, which is exactly what it should do — remembering is a second intention, and every assistant
 * that has a memory is told to have it.
 */
export const chatMemoryInstruction = [
  'You are answering inside Prism, a local research reading app. The Markdown notes in the vault belong to the researcher.',
  'Remembering is the last thing you do in a turn. After you have answered, call mcp__prism__remember on the note the conversation was about. Load that tool alongside the others rather than deciding at the end that you do not have it.',
  'The section is one list: what the researcher still does not understand about that note. Keep it true.',
  'Add a line when they say they do not follow something. Remove a line when they say they now do. Answering it yourself changes nothing — your explanation is not evidence that it landed, and only what they say counts.',
  'Call mcp__prism__read_note_memory first and send the whole list back every time. Whatever you leave out is removed, so a line you still believe belongs must be sent again. An empty list clears the section; send one only when nothing belongs there any more.',
  'Do not remember small talk, or what the note already says, or a summary of your own answer. Say in one short clause what you kept, and nothing more.',
  'Use mcp__prism__search_knowledge to find a note when you only know its title.',
  'You cannot write anywhere else in a note, and you should not try: what the researcher wrote is theirs.',
].join(' ')


export function autoMarkers(section: AutoSection) { return { open: `<!-- prism:auto ${section} -->`, close: `<!-- /prism:auto ${section} -->` } }
export function mineMarkers(section: MineSection) { return { open: `<!-- prism:mine ${section} -->`, close: `<!-- /prism:mine ${section} -->` } }

/** The one question every automatic writer has to pass: is this section mine to write for this kind of note? */
export function isAutoSection(nodeType: string, section: string): section is AutoSection {
  return (noteAutomation[nodeType] ?? []).some((rule) => rule.section === section)
}
export function isMineSection(nodeType: string, section: string): section is MineSection {
  return (noteMine[nodeType] ?? []).includes(section as MineSection)
}

/** What a conversation is allowed to keep in this kind of note. Everything else is derived or the researcher's. */
export function chatSections(nodeType: string) {
  return (noteAutomation[nodeType] ?? []).filter((rule) => rule.by === 'chat').map((rule) => rule.section)
}
export function isChatSection(nodeType: string, section: string): section is AutoSection {
  return chatSections(nodeType).includes(section as AutoSection)
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What the researcher has written in a marked section, if anything is there at all. */
export function mineRegion(content: string, section: MineSection) {
  const { open, close } = mineMarkers(section)
  const normalized = content.replace(/\r\n/g, '\n')
  const start = normalized.indexOf(open)
  if (start < 0) return undefined
  const end = normalized.indexOf(close, start)
  if (end < 0) return undefined
  return { from: start + open.length, to: end, text: normalized.slice(start + open.length, end).trim() }
}

/** True when this note holds a sentence only the researcher could have written. */
export function hasOwnWriting(nodeType: string, content: string) {
  for (const section of noteMine[nodeType] ?? []) if (mineRegion(content, section)?.text) return true
  const normalized = content.replace(/\r\n/g, '\n')
  for (const heading of legacyMineHeadings) {
    const match = normalized.match(new RegExp(`^##\\s+${escape(heading)}\\s*$`, 'm'))
    if (match?.index === undefined) continue
    const after = normalized.slice(match.index + match[0].length)
    const next = after.search(/^#{1,6}\s/m)
    if ((next < 0 ? after : after.slice(0, next)).trim()) return true
  }
  return false
}

/**
 * Opens a section for the researcher to write in. Nothing is written on their behalf — the markers give the
 * sentence a place to live and give the rest of the app something to ask about — and it is created only when
 * they ask for it, so a note is never a page of empty headings waiting to be filled in.
 */
export function insertMineSection(content: string, section: MineSection) {
  if (mineRegion(content, section)) return content
  const { open, close } = mineMarkers(section)
  const block = `## ${mineHeadings[section]}\n\n${open}\n\n${close}\n`
  const normalized = content.replace(/\r\n/g, '\n')
  // Reader captures pile up under 메모 and Notes and never stop, so a section the researcher just opened goes
  // above the pile — otherwise their own sentence is pushed further down the note every time they read.
  const pileAt = [/^##\s+메모\s*$/m, /^##\s+Notes\s*$/im].map((pattern) => normalized.search(pattern)).filter((at) => at >= 0).sort((left, right) => left - right)[0]
  if (pileAt !== undefined) return `${normalized.slice(0, pileAt)}${block}\n${normalized.slice(pileAt)}`
  return `${normalized.trimEnd()}\n\n${block}`
}

/**
 * Everything automation is allowed to change, removed. Two versions of a note that differ only inside
 * generated regions — including a generated section appearing or disappearing along with its heading —
 * reduce to the same string, and any other edit survives the reduction and shows up as a difference.
 */
export function withoutAutoSections(content: string) {
  let normalized = content.replace(/\r\n/g, '\n')
  for (const section of Object.keys(autoHeadings) as AutoSection[]) {
    const { open, close } = autoMarkers(section)
    const heading = `## ${autoHeadings[section]}`
    normalized = normalized.replace(new RegExp(`(?:^${escape(heading)}[^\\S\\n]*\\n+)?${escape(open)}[\\s\\S]*?${escape(close)}`, 'gm'), '')
    // A heading whose region was never written, or was just taken away, is generated scaffolding too.
    normalized = normalized.replace(new RegExp(`^${escape(heading)}[^\\S\\n]*\\n?(?=\\s*(?:#{1,6}\\s|$))`, 'gm'), '')
  }
  return normalized.replace(/[^\S\n]*\n\s*/g, '\n').trim()
}

/**
 * The guarantee, checked rather than promised. Every automatic write runs this against the note it started
 * from; if anything outside a generated region moved, the write is refused and the file stays exactly as the
 * researcher left it.
 */
export function assertOnlyAutoChanged(before: string, after: string, label: string) {
  if (withoutAutoSections(before) === withoutAutoSections(after)) return
  throw new Error(`${label}: 자동 기록이 사용자가 쓴 부분을 바꾸려 했습니다. 저장하지 않았습니다.`)
}
