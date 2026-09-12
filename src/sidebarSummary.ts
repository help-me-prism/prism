export function paperSummary(paper: { authors: string[]; published: string; categories: string[] }) {
  const author = paper.authors[0]?.trim()
  return [author && `${author}${paper.authors.length > 1 ? ' 외' : ''}`, paper.published?.slice(0, 4), !author && paper.categories.find(value => value !== 'PDF')].filter(Boolean).join(' · ') || '내가 가져온 PDF'
}

type Conversation = { messages: Array<{ role: string; text: string; primaryPaperId?: string; paperIds?: string[]; anchors?: Array<{ paperId: string; paperTitle: string }> }> }
function questionText(text: string) {
  return text.replace(/\[?@(?:근거|문장|섹션|수식|표|피겨|페이지)\d+(?:-[A-Za-z0-9]+)?\]?/g, '').replace(/\s+/g, ' ').trim()
}

export function conversationTitle(session: Conversation) {
  const questions = session.messages.filter(message => message.role === 'user').map(message => questionText(message.text)).filter(Boolean)
  // Short acknowledgements and continuation requests do not replace the topic.
  const topic = [...questions].reverse().find(text => !/^(?:네|예|응|좋아(?:요)?|고마워(?:요)?|감사합니다|계속(?:해\s*줘|해주세요)?|더\s*(?:설명해\s*줘|자세히)|yes|ok(?:ay)?|thanks?|continue)[.!?\s]*$/i.test(text))
  return topic || questions.at(-1) || (session.messages.some(message => message.role === 'user') ? '첨부한 근거 살펴보기' : '새 질문 시작하기')
}

export function conversationSummary(session: Conversation, papers: Array<{ arxivId: string; title: string }>) {
  const questions = session.messages.filter(message => message.role === 'user')
  if (!questions.length) return '논문을 열고 질문해 보세요'
  const linked = [...questions].reverse().find(message => message.primaryPaperId || message.paperIds?.length || message.anchors?.length)
  const id = linked?.primaryPaperId ?? linked?.paperIds?.[0] ?? linked?.anchors?.[0]?.paperId
  const title = papers.find(paper => paper.arxivId === id)?.title ?? linked?.anchors?.find(anchor => anchor.paperId === id)?.paperTitle
  return `질문 ${questions.length}개 · ${title || '논문 지정 없음'}`
}
