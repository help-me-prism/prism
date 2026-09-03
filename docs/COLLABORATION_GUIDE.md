# Prism 2인 협업 가이드 — Notes / AI Chat

이 문서는 Prism을 두 사람이 동시에 개발할 때 코드 소유권, 공용 계약, Git 작업 순서와 검증 기준을 정한다. 목표는 Notes·연구 지식 시스템과 AI Chat·응답 파싱을 병렬로 개발하면서, 서로의 작업을 덮어쓰거나 암묵적인 의존성을 만들지 않는 것이다.

## 1. 결론

다음과 같이 나누면 병렬 작업이 가능하다.

- **Notes 담당**: 노트 작성 경험, Markdown 보존, 템플릿, 지식 노드, 관계, 외부 파일 변경과 충돌 처리
- **AI Chat 담당**: Codex/Claude 연결, 스트리밍 이벤트, 채팅 상태, 응답 Markdown·수식·참조 파싱, composer UX

다만 현재 `electron/main.ts`, `electron/preload.cts`, `src/vite-env.d.ts`, `src/styles.css`, `package.json`은 두 영역이 함께 사용하는 충돌 지점이다. 이 파일은 아래의 공용 변경 절차 없이 동시에 수정하지 않는다.

## 2. 현재 경계

```text
Notes 창
src/NotesWindow.tsx
  └─ src/MarkdownEditor.tsx
       └─ window.prism.readPaperNote / savePaperNote

AI Chat
src/App.tsx
  ├─ 세션·composer·참조 칩·응답 렌더링
  └─ window.prism.sendMessage / cancelMessage / chat events

공용 Electron 경계
electron/preload.cts
  └─ electron/main.ts
       ├─ notes:* IPC
       └─ chat:* IPC
```

Notes는 별도 Electron `BrowserWindow`에서 `?view=notes`로 실행된다. 따라서 Notes 화면과 Chat 화면은 React 컴포넌트를 직접 참조하지 않아도 된다. 서로 필요한 데이터는 컴포넌트 import가 아니라 명시적인 IPC 계약이나 디스크 형식으로 교환한다.

## 3. 코드 소유권

### 3.1 Notes 담당 단독 영역

Notes 담당자가 자유롭게 수정하고 리뷰를 요청하는 파일과 기능:

- `src/NotesWindow.tsx`
- `src/MarkdownEditor.tsx`
- 향후 `src/features/notes/**`
- 향후 `src/features/knowledge/**`
- 향후 `electron/services/notes/**`
- 향후 `electron/services/vault/**`
- `scripts/smoke-notes-ui.mjs`
- Notes 전용 스타일 파일
- 템플릿, Paper/Concept/Claim/Insight/Question 노트
- 자동 저장, 외부 변경 감지, 충돌 해결
- 내부 링크, 관계, 근거 카드의 노트 측 표현

Notes 담당자는 `src/App.tsx`의 Chat 상태나 `chat:*` IPC를 직접 변경하지 않는다.

### 3.2 AI Chat 담당 단독 영역

AI Chat 담당자가 자유롭게 수정하고 리뷰를 요청하는 파일과 기능:

- `src/App.tsx`의 세션·메시지·composer·Chat 패널
- 향후 `src/features/chat/**`
- 향후 `electron/services/chat/**`
- Codex app-server 연결
- Claude CLI 연결
- `chat:send`, `chat:cancel`, `chat:event`, `chat:done`, `chat:error`
- 스트리밍 delta 병합과 중단
- 응답 Markdown, GFM, KaTeX 정규화와 렌더링
- 메시지 안의 문장·수식·표·피겨·페이지 참조 파싱
- `scripts/smoke-electron-ui.mjs`의 Chat 관련 검증
- Chat 전용 스타일 파일

AI Chat 담당자는 `NotesWindow`나 `MarkdownEditor`의 저장 상태와 Markdown 원문을 직접 변경하지 않는다.

### 3.3 공용 또는 사전 협의 영역

다음 파일은 한 명이 변경을 예고하고, 작은 별도 커밋으로 먼저 통합한 뒤 다른 작업을 이어간다.

| 파일/영역 | 충돌 원인 | 규칙 |
| --- | --- | --- |
| `electron/main.ts` | Notes와 Chat IPC가 같은 파일에 있음 | 동시에 편집하지 않는다. 가능한 즉시 도메인 모듈로 추출한다. |
| `electron/preload.cts` | 모든 renderer API가 한 객체에 있음 | IPC 이름·인자·반환 타입을 먼저 합의한다. |
| `src/vite-env.d.ts` | 앱 전체 타입과 `window.prism` 계약 | 공용 계약 변경만 담은 선행 커밋을 만든다. |
| `src/styles.css` | Notes와 Chat 스타일이 한 파일 | 먼저 도메인별 CSS로 분리한 후 각자 파일만 수정한다. |
| `src/main.tsx` | 기본 창과 Notes 창의 진입점 | 새 window/view를 추가할 때만 협의한다. |
| `package.json`, `package-lock.json` | 양쪽 의존성 설치가 같은 lockfile을 변경 | 한 번에 한 브랜치만 의존성을 추가하고 먼저 통합한다. |
| `HANDOFF.md` | 전체 프로젝트 상태 문서 | 기능 완료자가 통합 후 한 번만 갱신한다. |

## 4. 먼저 할 경계 정리

두 기능을 크게 확장하기 전에 아래 리팩터링을 동작 변경 없이 한 번 수행하는 것을 권장한다.

```text
shared/
  contracts/
    chat.ts
    notes.ts
    anchors.ts
    ipc.ts

electron/
  ipc/
    registerChatIpc.ts
    registerNotesIpc.ts
  services/
    chat/
    notes/

src/
  features/
    chat/
    notes/
  styles/
    chat.css
    notes.css
```

최소한 다음 세 가지부터 분리한다.

1. `electron/main.ts`의 `chat:*`와 `notes:*` 핸들러를 별도 등록 함수로 옮긴다.
2. `src/styles.css`에서 `.chat-*`, `.composer-*`와 `.notes-*`, `.markdown-*` 규칙을 각각 전용 파일로 옮긴다.
3. IPC 요청·응답 타입을 공용 계약 파일에 두고 main, preload, renderer가 같은 타입을 사용한다.

이 리팩터링 커밋이 통합되기 전에는 한쪽만 공용 파일을 수정하고 다른 쪽은 단독 영역에서 작업한다.

## 5. 두 영역이 데이터를 교환하는 방법

두 영역을 직접 import로 연결하지 않는다. 예를 들어 Chat이 현재 노트를 AI 문맥으로 사용하게 되더라도 Chat 컴포넌트가 `NotesWindow` 상태를 읽어서는 안 된다.

권장 흐름:

```text
Notes가 Markdown과 구조화 메타데이터 저장
  → Notes 서비스가 읽기 전용 KnowledgeContext 제공
  → preload의 명시적 API
  → Chat이 선택된 문맥만 요청
```

공용 계약 예시:

```ts
export type KnowledgeContext = {
  noteId: string
  title: string
  type: 'paper' | 'concept' | 'claim' | 'insight' | 'question'
  markdown: string
  evidence: EvidenceRef[]
}

export type EvidenceRef = {
  paperId: string
  anchorId: string
  type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'
  page: number
  label: string
}
```

계약에는 화면 상태, React ref, DOM 요소, CodeMirror 객체를 넣지 않는다. 파일로 저장하거나 IPC로 전달할 수 있는 JSON 데이터만 사용한다.

### 공용 계약 변경 순서

1. 필요한 사용 사례를 한 문장으로 적는다.
2. 요청·응답 타입과 오류 조건을 합의한다.
3. 타입과 빈 구현만 담은 `contract:` 커밋을 먼저 통합한다.
4. Notes와 Chat이 각자의 브랜치에서 해당 계약을 구현한다.
5. 한쪽 구현 세부사항을 다른 쪽에서 직접 참조하지 않는다.

## 6. Git 브랜치 운영

`kys_enhanced`는 통합 브랜치로 사용하고 기능 개발은 직접 하지 않는다.

```bash
# Notes 담당
git switch kys_enhanced
git pull --ff-only origin kys_enhanced
git switch -c feature/notes-<작업명>

# AI Chat 담당
git switch kys_enhanced
git pull --ff-only origin kys_enhanced
git switch -c feature/chat-<작업명>
```

브랜치 예시:

- `feature/notes-external-change`
- `feature/notes-templates`
- `feature/chat-stream-parser`
- `feature/chat-note-context`
- `refactor/split-ipc-domains`

### 커밋 규칙

- 한 커밋에는 하나의 검증 가능한 변경만 넣는다.
- 리팩터링과 기능 변경을 같은 커밋에 섞지 않는다.
- 공용 계약 변경은 `contract:` 또는 `refactor:` 커밋으로 분리한다.
- 생성 파일인 `dist/`, `dist-electron/`, `release/`, `tmp/`는 커밋하지 않는다.
- 관련 없는 상대방 파일을 포맷하거나 정리하지 않는다.
- push와 온라인 패키징은 팀에서 합의한 시점에만 한다.

권장 커밋 예시:

```text
refactor: split notes and chat ipc registration
contract: add knowledge context ipc types
feat(notes): detect external markdown changes
feat(chat): parse streamed tool references
test(notes): cover conflict-safe autosave
```

## 7. 병합 절차

각 기능 브랜치에서 다음 순서를 지킨다.

```bash
git fetch origin
git rebase origin/kys_enhanced
npm ci
npm run build
```

그다음 담당 영역 테스트를 실행한다.

### Notes 변경

```bash
npm run test:notes-ui
```

비단순 UI 변경은 `tmp/ui/notes-live-edit.png` 또는 새 캡처를 직접 확인한다.

### AI Chat 변경

```bash
npm run test:ui
```

응답 Markdown, 수식, 참조 칩 또는 스크롤을 바꿨다면 실제 Electron 화면 캡처를 확인한다.

### 공용 계약·IPC·스타일·의존성 변경

```bash
npm run build
npm run test:notes-ui
npm run test:ui
```

두 테스트가 모두 성공한 커밋만 `kys_enhanced`에 병합한다. 첫 브랜치가 병합된 뒤 두 번째 브랜치는 갱신된 `kys_enhanced` 위로 rebase하고 다시 테스트한다.

## 8. 충돌 방지 체크리스트

작업을 시작하기 전에:

- 담당 영역과 완료 조건을 한 문장으로 공유했는가?
- 공용 파일을 수정해야 하는가?
- 상대방이 같은 공용 파일을 수정 중이지 않은가?
- 새 IPC 또는 새 npm 의존성이 필요한가?
- 사용할 공용 데이터 타입이 먼저 합의됐는가?

병합하기 전에:

- 상대방 단독 영역을 불필요하게 변경하지 않았는가?
- Markdown 원문과 사용자 작성 내용을 그대로 보존하는가?
- Chat 파서가 화면 표시용 정규화 때문에 저장된 원문을 바꾸지 않는가?
- IPC 입력을 main 프로세스에서 검증하는가?
- Windows와 macOS 경로에 절대 경로나 `\\` 구분자를 저장하지 않는가?
- 담당 smoke test와 `npm run build`가 성공하는가?
- 비단순 UI 변경을 실제 화면에서 확인했는가?

## 9. 작업 인계 양식

브랜치를 넘기거나 병합을 요청할 때 아래 형식을 사용한다.

```text
브랜치:
담당 영역: Notes / AI Chat / Shared Contract
목표:
변경 파일:
공용 계약 변경:
사용자 데이터 형식 변경:
실행한 테스트:
화면 확인:
남은 문제:
상대방이 이어서 해야 할 일:
```

## 10. 현재 추천 첫 병렬 작업

경계 정리 후 다음 두 작업은 서로 거의 충돌하지 않는다.

### Notes 담당

- 외부 Markdown 변경 감지
- 저장 직전 hash 비교
- 디스크 버전과 편집 버전의 충돌 안내
- 원자적 파일 저장
- `npm run test:notes-ui` 회귀 추가

### AI Chat 담당

- Chat 코드를 `src/features/chat`으로 추출
- provider 스트리밍 이벤트 타입 정리
- Markdown·수식·참조 파서를 순수 함수로 분리
- parser 단위 테스트 추가
- `npm run test:ui` 회귀 유지

이 두 작업이 끝난 뒤 `KnowledgeContext` 계약을 추가하면 Chat이 사용자가 선택한 노트만 안전하게 문맥으로 가져가는 기능을 양쪽이 독립적으로 구현할 수 있다.
