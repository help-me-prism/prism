import { useMemo, useState } from 'react'
import { ArrowRight, BookOpen, Lightbulb, Search } from 'lucide-react'

export default function NotesHome({ nodes, libraryPath, onOpenNode, onChooseLibrary }: {
  nodes: KnowledgeNodeRecord[]; libraryPath?: string; onOpenNode: (id: string) => void; onChooseLibrary: () => void
}) {
  const [mode, setMode] = useState<'recall' | 'ideas'>('recall')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(12)
  const papers = useMemo(() => nodes.filter(node => node.nodeType === 'paper' && node.status !== 'archived').sort((a, b) => b.modifiedAt - a.modifiedAt), [nodes])
  const filtered = papers.filter(node => (mode === 'recall' || node.recall?.apply || node.recall?.unresolved) &&
    `${node.title} ${Object.values(node.recall ?? {}).join(' ')} ${node.preview}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <div className="notes-home">
    <header className="recall-home-head">
      <span className="recall-eyebrow">나의 연구 노트</span>
      <h1>다시 읽기 전에,<br />내가 남긴 생각부터.</h1>
      <p>기억할 핵심과 다음에 해볼 일을, 논문 한 편마다 짧게 남겨두세요.</p>
      {!libraryPath && <button className="recall-primary" onClick={onChooseLibrary}>노트 폴더 선택 <ArrowRight size={15} /></button>}
    </header>
    {libraryPath && <>
      <div className="recall-home-tools">
        <div className="recall-switch" role="group" aria-label="노트 모아보기">
          <button aria-pressed={mode === 'recall'} onClick={() => { setMode('recall'); setLimit(12) }}><BookOpen size={15} /> 다시 떠올리기</button>
          <button aria-pressed={mode === 'ideas'} onClick={() => { setMode('ideas'); setLimit(12) }}><Lightbulb size={15} /> 연구 아이디어</button>
        </div>
        <label className="recall-search"><Search size={15} /><input aria-label="논문과 내 생각 검색" placeholder="논문, 기억나는 단어 검색" value={query} onChange={event => { setQuery(event.target.value); setLimit(12) }} /></label>
      </div>
      <div className="recall-list-heading"><h2>{mode === 'recall' ? '논문별 읽기 기록' : '질문에서 시작하는 다음 연구'}</h2><span>{filtered.length}편</span></div>
      {mode === 'ideas' && <p className="recall-mode-hint">남겨둔 질문과 적용 아이디어를 나란히 보며, 다음에 검증할 것을 찾아보세요.</p>}
      {filtered.length ? <div className="recall-grid">{filtered.slice(0, limit).map(node => <button className="recall-card" key={node.id} onClick={() => onOpenNode(node.id)}>
        <div className="recall-card-top"><span>{node.readingStatus === 'read' ? '읽은 논문' : '읽기 기록'}</span><ArrowRight size={16} /></div>
        <h3>{node.title}</h3>
        {mode === 'recall' && <div className={`recall-card-summary${node.recall?.restate ? '' : ' is-empty'}`}><small>기억할 핵심</small><p>{node.recall?.restate || '이 논문이 보여준 것을 내 말로 한 줄 남겨보세요.'}</p></div>}
        {(node.recall?.unresolved || mode === 'ideas') && <div className="recall-card-question"><small>남은 질문</small><p>{node.recall?.unresolved || '아직 남긴 질문이 없습니다.'}</p></div>}
        {(node.recall?.apply || mode === 'ideas') && <div className="recall-card-idea"><small>내 연구에 쓸 아이디어</small><p>{node.recall?.apply || '조건이나 대상을 바꾸면 무엇을 시험할 수 있을까요?'}</p></div>}
        <footer>{node.evidenceCount > 0 ? `저장한 근거 ${node.evidenceCount}개 · ` : ''}{node.recall?.restate ? '기록 이어보기' : '핵심 한 줄 남기기'}</footer>
      </button>)}</div> : <div className="recall-empty"><BookOpen size={27} strokeWidth={1.4} /><h3>{query ? '일치하는 기록이 없습니다' : mode === 'ideas' ? '다음 연구는 작은 질문에서 시작됩니다' : '첫 논문에서 한 줄만 남겨보세요'}</h3><p>{query ? '다른 단어로 찾아보세요. 전체 본문은 왼쪽 노트 검색에서 찾을 수 있습니다.' : mode === 'ideas' ? '논문 노트의 ‘남은 질문’이나 ‘내 연구에 쓸 아이디어’에 적으면 여기에 모입니다.' : '논문을 읽은 뒤 노트를 열고, 기억할 핵심부터 적어보세요. 세 칸을 모두 채울 필요는 없습니다.'}</p>{!query && <button onClick={() => mode === 'ideas' ? setMode('recall') : void window.prism.openPaperInReader()}>{mode === 'ideas' ? '논문 기록 보기' : '논문 리더 열기'} <ArrowRight size={14} /></button>}</div>}
      {filtered.length > limit && <button className="recall-more" onClick={() => setLimit(value => value + 12)}>기록 더 보기</button>}
    </>}
    <p className="recall-storage">직접 쓴 기록은 자동 저장됩니다. 노트 폴더의 Markdown 파일을 Obsidian에서도 열 수 있습니다.</p>
  </div>
}
