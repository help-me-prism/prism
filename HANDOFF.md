# Prism 개발 인수인계 노트

마지막 정리: 2026-09-02  
작업 브랜치: `kys_enhanced`
기능 구현 기준 커밋: 이번 작업 완료 커밋(표·수식 보존 및 교차 플랫폼 실행 개선)

이 문서는 새로운 Codex/Claude 대화나 다른 개발자가 현재 상태를 빠르게 파악하고 바로 이어서 작업하기 위한 기준 문서다. 다음 작업을 시작할 때는 먼저 `git checkout kys_enhanced`와 `git pull origin kys_enhanced`를 실행하고 이 문서를 읽는다.

## 1. 제품 목표

Prism은 논문을 검색·보관하고 원문과 한국어 번역을 읽으면서, 문장·수식·피겨를 AI 채팅에 구조화된 참조로 넘기고, 장기적으로는 Obsidian에서 관리 가능한 연구 노트를 만드는 로컬 데스크톱 앱이다.

- Windows와 macOS에서 동작하는 Electron 앱
- arXiv 논문 검색, PDF 및 가능한 LaTeX 원본 다운로드
- 원문/한국어/병기 모드의 연속 PDF 리더
- Codex CLI 또는 Claude CLI를 연결한 스트리밍 채팅
- 채팅과 별도 모델로 수행하는 논문 번역 및 디스크 캐시
- 문장·수식·피겨·페이지를 `@태그`로 AI 문맥에 연결
- Markdown 노트, 논문 간 연결, 앵커 단위 메모를 통한 Obsidian 연동

## 2. 현재 실행 방법

Node.js 22.12 이상에서 Windows는 `run-windows.cmd`, macOS는 `run-macos.command`를 더블클릭하면 최초 의존성 설치와 현재 소스 빌드 후 실행된다. 터미널에서는 다음을 사용한다.

```powershell
npm ci
npm start
```

- 개발 모드: `npm run dev`
- 타입 검사와 프로덕션 빌드: `npm run build`
- Windows portable EXE: `npm run package:win`
- 생성 파일: `release/Prism 0.1.0.exe`
- 현재 Mac용 DMG 명령: `npm run package:mac` — GitHub Actions는 `macos-15-intel`과 `macos-15` runner에서 Intel/Apple Silicon DMG를 각각 생성한다. 실제 Mac UX 및 서명 검증은 아직 필요하다.

`index.html`을 브라우저에서 직접 열면 `file://` CORS 문제로 동작하지 않는다. 반드시 Electron 실행 명령이나 패키징된 EXE를 사용한다.

채팅을 사용하려면 해당 CLI가 PATH에 설치되고 로그인되어 있어야 한다.

```powershell
codex login
# Claude를 쓸 경우 Claude CLI 설치 및 로그인도 별도로 필요
```

## 3. 주요 파일과 역할

| 파일 | 역할 |
| --- | --- |
| `src/App.tsx` | 다중 채팅 세션, 모델 선택, 스트리밍 이벤트 반영, 참조 칩, 구조화 문맥 생성 |
| `src/PaperWorkspace.tsx` | 논문 검색 UI, PDF 렌더링, 문장 분할, 번역 레이어, 탭/병기/스크롤, 태그와 피겨 캡처 |
| `src/styles.css` | VS Code형 3열 UI, PDF/번역 레이어, 참조 칩과 호버 미리보기 |
| `electron/main.ts` | CLI 프로세스, 세션 저장, arXiv/Semantic Scholar, 파일 저장, 번역 배치, Electron IPC |
| `electron/latex.ts` | arXiv LaTeX 소스 전개와 문단·제목·수식·피겨·표 구조 추출 |
| `electron/preload.cts` | sandboxed renderer에 허용된 IPC API만 노출 |
| `src/vite-env.d.ts` | renderer와 main 사이에서 사용하는 데이터 타입 |

## 3.1 2026-09-02 추가 구현

- 병기 모드 가운데 divider를 드래그해 원문/한국어 패널 폭을 25~75% 범위에서 조절한다.
- 원문과 한국어 문서가 각각 배율 상태를 가지며 `스크롤`, `확대` 동기화 토글을 별도로 제공한다. 동기화를 끄면 각 패널의 버튼이나 Ctrl+휠로 독립 조작한다.
- 한국어 번역 block의 최소/최대 font size를 PDF scale과 함께 배율화해 확대할 때 줄 수가 바뀌던 문제를 수정했다.
- arXiv LaTeX의 `includegraphics` 파일을 안전한 source 폴더 안에서 찾아 PNG/JPEG/SVG/PDF 자산으로 읽는다. PDF 피겨 파일은 PDF.js로 첫 페이지 preview를 만든다.
- PDF operator list의 image paint transform도 분석해 이미지 bounding box를 보조 탐지한다. LaTeX 피겨와 PDF 캡션을 순서대로 매칭하고 기본 상태에서 hover/click 가능한 영역을 제공한다.
- 자동 인식되지 않은 피겨를 위한 기존 수동 모드는 `피겨 캡처`로 이름을 바꿨으며 클릭 또는 드래그 캡처를 유지한다.
- Notes는 Reader side panel에서 제거하고 `?view=notes` renderer를 쓰는 독립 Electron BrowserWindow로 옮겼다. 논문 목록, Markdown 편집, 500ms 자동 저장을 제공하므로 다른 모니터에 둘 수 있다.
- 왼쪽 Highlights 항목을 제거했다. `폴더 선택`, 논문 트리, `논문 열기`, 검색 버튼을 실제 PaperWorkspace command에 연결했다.
- 왼쪽 논문 트리에서 논문을 클릭하면 기존 탭에 열리고, 새 폴더 선택 시 해당 라이브러리의 논문 목록과 첫 탭으로 교체된다.
- 채팅 모델 설정 아래에 복수 논문 컨텍스트 선택 메뉴를 추가했다. 선택한 논문 ID/제목은 `<paper_context>`로 매 질문에 포함된다.
- `@` 입력 시 현재 앵커의 자동완성 메뉴를 표시하고, 태그 칩에 논문 ID를 보여 여러 논문 참조를 구분한다.
- 전송된 메시지의 태그 칩을 클릭하면 해당 논문 탭·페이지·anchor 위치로 이동한다.

관련 커밋: `80be200`

## 3.2 `kys_enhanced` 제품 완성도 개선

- 실제 Electron 창을 캡처·조작하는 외부 의존성 없는 CDP 진단 도구와 격리된 `npm run test:ui` smoke를 추가했다. smoke는 1040×680 최소 창 크기에서 첫 실행, 검색 dialog 포커스/Escape, 설정, 대화 삭제 undo, CSP를 확인한다.
- 제품 리뷰와 반복별 검증 결과는 `docs/UX_REVIEW.md`에 기록한다.
- 검색 modal의 빈 상태, 안내, 글자 크기, 접근성 이름과 키보드 닫기를 개선했다.
- 무반응 설정/더보기 컨트롤을 실제 CLI 상태·라이브러리·단축키 설정 dialog로 교체했다.
- 대화 삭제는 6초 undo를 제공하고 마지막 대화나 실행 중 대화의 삭제를 막는다.
- `@` 자동완성에 위/아래, Enter/Tab 선택, Escape 닫기를 추가했다.
- 15페이지 테스트 논문에서 약 24초 걸리던 초기 리더 진입을 약 2초로 줄였다. PDF를 피겨 preview보다 먼저 열고 인접 페이지만 canvas/operator를 lazy render하며 전체 앵커 분석 진행률을 표시한다.
- 병기 스크롤은 전체 문서 비율 대신 같은 페이지 내부 위치를 동기화한다. 확대 전 페이지 위치도 확대 후 복원하며, 좁은 원문 box에서 한국어가 세로로 쌓이지 않도록 번역 block 최소 폭을 보정한다.
- 사이드바의 중복 검색 아이콘을 제거하고 `논문 열기` 위 최상단에 현재 라이브러리 폴더 이름을 표시한다. Notes 창도 설정 전에는 폴더 선택, 설정 후에는 `CURRENT REPOSITORY`와 폴더명을 표시한다.
- 채팅 답변은 GFM Markdown과 KaTeX로 제목·목록·표·코드·수식을 렌더링한다. CLI가 자주 반환하는 `\\[...\\]`와 `\\(...\\)`도 표시 전에 KaTeX 구분자로 정규화한다. 문장·수식·피겨·표·페이지 참조는 contenteditable 질문의 현재 커서 위치와 전송된 질문·답변 본문 안에 타입별 원자적 아이콘 태그로 표시한다.
- 스트리밍 자동 스크롤은 사용자가 하단을 보고 있을 때만 유지한다. 위로 스크롤하면 읽던 위치를 보존하고 `최신 답변으로` 버튼을 제공한다.
- 삭제한 대화는 `deletedAt`과 함께 `sessions.json`에 보존되며 사이드바 휴지통 또는 즉시 실행 취소 toast에서 복원할 수 있다.
- UI smoke는 휴지통 복원, Markdown 제목·표, KaTeX, 인라인 수식 태그, 자동 스크롤 일시정지를 추가 검증한다. 시각 샘플은 로컬 `tmp/ui/chat-markdown.png`에 생성된다.
- Notes는 논문·라이브러리 전환, blur, unload에서 dirty 내용을 flush하고 절대 경로 대신 로컬 Markdown 파일명을 표시한다.
- 번역 진행 중 버튼으로 작업을 중지할 수 있으며 완료된 batch cache는 유지한다.
- renderer CSP를 명시하고 Electron 보안 경고를 smoke 회귀 조건으로 추가했다.
- macOS Finder 실행의 제한된 PATH를 고려해 Homebrew, `~/.local/bin`, npm global, Claude local 경로를 탐색한다. `PRISM_CODEX_PATH`, `PRISM_CLAUDE_PATH` override도 지원한다.
- 세션 저장 전 피겨 thumbnail data URL만 제거해 15MB 초과로 전체 채팅 자동 저장이 중단되는 문제를 예방한다. 원본 피겨 파일과 anchor 문맥은 유지한다.
- LaTeX 수식은 PDF 수식 segment와 토큰 유사도로 연결하고, 표는 `table`/`tabular` 및 중첩된 `algorithm` 원본 블록을 PDF `Table N`/`Algorithm N` 캡션에 연결해 별도 구조 태그로 노출한다. AI 문맥에는 축약하지 않은 원본 LaTeX가 전달된다. 구조 캐시는 version 3이며 이전 캐시는 자동 재생성된다.
- 한국어 번역층이 수식·표·피겨를 덮지 않도록 겹침이 적은 방향으로 텍스트 block을 확장하고, 보호 구조 영역은 원본 PDF canvas에서 다시 그려 글자·선 누락을 막는다.
- 채팅 인라인 태그에 표 타입과 아이콘을 추가했으며 UI smoke가 수식과 표 태그를 함께 검증한다.
- `.nvmrc`, OS별 원클릭 실행 스크립트와 Windows/macOS GitHub Actions 패키징을 추가했다. macOS는 교차 패키징을 피하고 Intel/Apple Silicon 네이티브 runner에서 DMG를 각각 만든다. `release/`는 계속 Git에서 제외하고 Actions artifact로 공유한다.

관련 커밋: `ddfb479`, `caf1f89`, `6474baf`, `5693042`

## 4. 오늘 구현된 내용

### 4.1 데스크톱 앱과 CLI 채팅

- Electron + React + TypeScript + Vite로 구성했다.
- Codex는 `codex app-server --stdio`를 한 번 띄워 JSON-RPC로 thread를 시작/재개한다.
- Claude는 메시지 요청마다 `claude -p --output-format stream-json --include-partial-messages`를 실행하고 저장된 session ID로 재개한다.
- 두 CLI 모두 생성되는 delta를 Electron IPC로 renderer에 즉시 전달하므로 답변이 한 번에 나타나지 않고 스트리밍된다.
- 대화별 provider, model, provider thread ID, 메시지를 Electron `userData/sessions.json`에 자동 저장한다.
- 여러 대화를 만들고 전환할 수 있으며, 실행 중인 대화는 별도로 추적하고 중지할 수 있다.
- Codex 모델 목록은 `~/.codex/models_cache.json`을 우선 읽고 실패하면 내장 fallback을 사용한다. Claude는 Sonnet/Opus/Haiku 선택지를 제공한다.
- 채팅 CLI는 현재 `Documents`를 cwd로 하고 read-only/plan 권한으로 실행된다.

관련 커밋: `62a4474`

### 4.2 arXiv 검색과 로컬 논문 라이브러리

- 제목, 키워드, arXiv ID, abs/pdf 링크를 입력할 수 있다.
- 입력 중 Semantic Scholar autocomplete를 280ms debounce로 요청한다.
- arXiv 결과에 제목 정확 일치, 토큰 중복률, Semantic Scholar 인용 수를 합산한 점수를 적용해 유명하고 정확한 논문을 위로 올린다.
- arXiv rate limit 때 Semantic Scholar 검색을 fallback으로 사용한다.
- 저장 폴더는 Electron 폴더 선택창으로 지정한다.
- 논문 저장 시 PDF, metadata, Markdown 노트, 가능한 arXiv source archive를 다운로드한다.
- source archive는 안전하게 압축 해제하고 가능한 경우 `latex-structure.json`을 생성한다.

관련 커밋: `2a92753`

### 4.3 PDF 리더와 번역 문서

- PDF.js로 전체 페이지를 canvas에 렌더링하고 모든 페이지를 세로로 이어서 스크롤한다.
- 원문, 한국어, 병기 모드를 탭처럼 전환한다. 병기 모드에서는 양쪽 스크롤 비율을 동기화한다.
- 상단 `-`, 배율 선택, `+` 버튼과 `Ctrl + 마우스 휠`로 70~200% 확대/축소한다.
- 한국어 문서는 별도 PDF 파일을 생성하는 방식이 아니다. 원본 canvas의 피겨·표·수식을 유지하고 영문 텍스트 영역 위에 한국어 텍스트 레이어를 배치하는 현재 단계의 구현이다.
- 번역 문장은 문장별로 표시되지만 CLI 호출은 문장 하나씩 하지 않는다. 번역 대상 segment들을 합계 약 9,000자 단위 batch로 묶어 한 번에 JSON 배열로 넘긴다.
- 각 항목은 `{id, source, sourceMode, blockId, section, paragraphContext}` 구조이며 모델은 `{id, translation}` 배열만 반환해야 한다.
- 제목·본문·캡션만 번역하고 수식과 artifact는 원문을 유지한다.
- 각 batch 완료 때 `translation.ko.json`을 저장해 중간 실패 시에도 완료분을 재사용한다.
- 캐시가 있으면 버튼을 `재번역`으로 표시하며, 강제 재번역 시 기존 번역을 비운다.
- 번역 진행률은 전체 번역 가능 문장 수 대비 완료 문장 수와 퍼센트로 표시한다.
- Noto Serif KR Variable을 사용하고 문단 단위 box에서 한국어 길이에 따라 글꼴 크기와 높이를 계산한다. 번역이 길면 원래 높이를 넘어 아래로 흐를 수 있다.

관련 커밋: `32a44b8`, `e11cbc3`, `f880a02`, `188bbe2`

### 4.4 문장 분할과 LaTeX 우선 문맥

현재 문장과 화면 좌표를 연결하는 기준은 PDF text item이다.

1. PDF.js `getTextContent()`의 item을 읽는다.
2. 줄 높이, Y 간격, column reset, 제목 패턴, 하이픈 연결을 이용해 문단 후보를 만든다.
3. `Intl.Segmenter('en', {granularity: 'sentence'})`로 문장을 나눈다.
4. 각 문장이 차지하는 PDF item의 부분 범위를 0~1 비율인 `itemSlices`로 저장한다.
5. 문장 ID는 페이지, 순서, 문장 hash로 만든다. 예: `p4-s12-...`.
6. 원본 LaTeX가 있으면 `\input`/`\include`를 전개하고 제목, 문단, 캡션, 수식, 피겨, 표와 algorithm 환경을 분리한다. figure 안에 중첩된 algorithm도 먼저 보호해 일반 문장 번역에서 제외한다.
7. PDF 문장 토큰과 LaTeX 문단 토큰의 겹침 점수를 계산해 일치하는 LaTeX 문단을 `paragraphContext`와 section 문맥으로 붙인다.

중요: 현재 LaTeX는 번역 문맥과 구조 보강에 사용된다. LaTeX 문서 자체의 영문을 교체하고 XeLaTeX/LuaLaTeX로 한국어 PDF를 다시 컴파일하는 단계는 아직 아니다.

### 4.5 하이라이트와 참조 태그

- PDF text item transform에 viewport transform과 폰트 ascent/descent를 적용해 하이라이트 사각형의 baseline 오차를 보정했다.
- `itemSlices`의 시작/끝 비율만큼 item 폭을 잘라 문장 일부만 정확히 강조한다.
- 같은 segment ID를 원문과 번역 레이어가 공유하므로 한쪽에 마우스를 올리면 양쪽 문장이 함께 강조된다.
- 문장, 수식, 피겨, 표, 페이지를 클릭하면 마지막 채팅 커서 위치에 제거 가능한 참조 토큰이 생긴다. 토큰의 `textOffset`과 고유 `placementId`를 메시지에 저장해 같은 anchor를 여러 문장 위치에서 다시 사용할 수도 있다.
- 사용자가 `@문장36` 또는 `[@문장36]`을 직접 입력해도 450ms 후 원시 텍스트를 제거하고 같은 칩으로 변환한다.
- 칩을 호버하면 문장/수식 원문을 보여준다.
- 전송 시 화면에 보이는 질문 텍스트와 `ContextAnchor[]`를 함께 메시지에 저장한다.
- CLI prompt의 질문 본문에도 각 `[@태그]`를 원래 위치에 삽입한다. 구조화 anchor에는 `occurrence`, `text_offset`, 앞뒤 40자 문맥을 포함하므로 모델이 참조 대상뿐 아니라 문장 안에서의 역할도 구분할 수 있다.
- CLI에는 질문 뒤에 다음과 같은 구조화 문맥을 붙인다.

```xml
<prism_context>
  <anchor ref="@문장36" type="sentence" paper="1706.03762" stable_id="..." page="4">
    원문 내용
  </anchor>
</prism_context>
```

따라서 모델은 태그 표기만 받는 것이 아니라 논문 ID, 안정 ID, 페이지, 타입, 실제 내용을 함께 받는다.

관련 커밋: `17c8449`, `f880a02`, `188bbe2`

### 4.6 피겨 태그

- `피겨 태그` 모드에서 드래그하면 지정 영역을 정확히 캡처한다.
- 짧게 클릭하면 클릭 지점을 중심으로 페이지의 약 72% 너비, 34% 높이 이내의 기본 영역을 자동 캡처한다.
- 원본 해상도의 PNG는 논문 폴더 `figures/`에 저장하고 정규화 좌표도 JSON metadata로 남긴다.
- 채팅 칩에는 최대 280×210 JPEG thumbnail을 넣어 호버할 때 작은 이미지 미리보기를 표시한다.
- 빠른 click에서 React state 반영 전에 pointerup이 발생하던 문제는 selection을 state와 `useRef`에 동시에 보관해 해결했다.

중요: 현재 AI에 전달되는 피겨 문맥은 저장된 이미지 경로와 페이지/좌표 설명이다. 이미지 바이트를 Codex/Claude의 멀티모달 입력 형식으로 직접 첨부하는 기능은 아직 없다.

관련 커밋: `17c8449`, `188bbe2`

### 4.7 Markdown 노트

- 논문마다 YAML frontmatter가 있는 `<arxiv-id>.md`를 만든다.
- 노트 패널에서 편집한 내용은 500ms debounce로 해당 Markdown 파일에 저장한다.
- frontmatter에 arXiv ID, 제목, 저자, 출판일, 원문 URL, PDF 경로, tags, related 필드를 둔다.
- 현재는 논문별 단일 자유 형식 Markdown 노트까지만 구현되어 있다.

## 5. 라이브러리 저장 구조

```text
library/
  .prism/
    library.json
  papers/
    1706.03762/
      original.pdf
      source.tar.gz
      source/
      metadata.json
      latex-structure.json
      anchors.json
      translation.ko.json
      figures/
        figure-p4-....png
        figure-p4-....json
      1706.03762.md
```

- 앱 설정과 채팅 세션은 Electron `userData`에 저장한다.
- 논문, 번역, 피겨, 노트는 사용자가 선택한 라이브러리 폴더에 저장한다.
- `translation.ko.json`은 provider/model/source hash/segment/translation을 포함한다.
- `anchors.json`은 PDF 좌표와 안정 ID를 포함해 향후 앵커 노트와 링크에 사용할 기반 데이터다.

## 6. 검증한 내용

- `npm run build` 성공
- `npm run package:win` 성공
- Windows portable EXE 생성 및 실행 확인
- 테스트용 로컬 논문 라이브러리에서 PDF 15페이지 연속 렌더링 확인
- 직접 입력한 `@문장36`이 textarea에서 사라지고 참조 칩으로 전환되는 것 확인
- Ctrl+휠로 100%에서 115% 확대되는 것 확인
- 폰트 ascent 기준 하이라이트가 실제 텍스트 baseline과 맞는 것 화면 확인
- 피겨 짧은 클릭 후 PNG 저장, 선택 모드 종료, 피겨 칩 생성 확인
- 피겨 칩의 280px thumbnail 생성과 호버 미리보기 확인
- 병기 divider를 드래그해 421/414px에서 314/520px로 패널 비율 변경 확인
- 확대 동기화를 끈 뒤 원문 115%, 한국어 130%로 독립 변경 확인
- Attention Is All You Need의 LaTeX source에서 피겨 자산 5개를 찾아 PDF 캡션/이미지 영역과 연결한 것 확인
- 기본 상태의 피겨 영역 클릭으로 source preview가 있는 태그 칩 생성 확인
- `피겨 캡처`의 수동 드래그 캡처가 계속 동작하는 것 확인
- `@문` 입력 시 8개 앵커 자동완성, 선택 후 원시 입력 제거와 칩 생성 확인
- 왼쪽 검색 버튼에서 기존 arXiv Finder가 열리는 것 확인
- Notes 버튼에서 별도 Electron 창이 열리고 논문 목록과 Markdown textarea가 표시되는 것 확인
- `npm run test:ui` 성공 — 1040×680 최소 창, 검색 dialog, 설정, 삭제 undo, CSP 검증
- DDPM 25페이지와 Attention Is All You Need 15페이지 전체 번역 UI audit 완료
- 최대화 2560×1392 병기 화면에서 표·수식·그림·참고문헌·부록 집중 페이지를 원문과 비교 확인
- 전체 40페이지에서 raw LaTeXiT payload, 번역 block overflow, 세로형 텍스트, 페이지 바깥 이탈 0건 확인
- Attention Is All You Need를 테스트 라이브러리에 실제 검색·저장하고 2초 이내 첫 페이지 표시 확인
- Notes blur 직후 실제 Markdown 파일 저장 확인
- Windows portable EXE 재생성 확인 (`release/Prism 0.1.0.exe`, 약 107MB)
- macOS 한글 IME 조합 이벤트를 모사한 UI 회귀 테스트에서 `한글` 두 음절이 중간 렌더링 없이 유지되는 것 확인
- Codex CLI 존재 여부와 별개로 `codex login status`가 성공해야만 채팅·번역을 사용 가능하게 표시하도록 변경
- 제공된 PRISM 이미지를 앱 UI PNG, Windows ICO, macOS ICNS로 변환하고 각 형식을 다시 열어 크기와 포맷 확인

테스트용으로 실제 사용자 설정을 바꾸지 않으려면 다음 환경 변수를 사용할 수 있다.

```powershell
$env:PRISM_TEST_LIBRARY_PATH='C:\path\to\test-library'
$env:PRISM_TEST_DISABLE_AUTO_TRANSLATE='1'
npm run start:fast
```

## 7. 남은 작업과 우선순위

### P0 — 다음 작업에서 먼저 다룰 것

1. **한국어 문서 레이아웃 완성도**
   - DDPM과 Attention 두 기준 논문은 전체 페이지 회귀를 통과했다. 다른 PDF의 긴 한국어 문단, 2단 컬럼, 회전 텍스트와 각주는 계속 corpus를 늘려 검증해야 한다.
   - 단기안: 새 오류 문서를 corpus에 추가하고 `scripts/audit-translation-ui.mjs`의 overflow/raw/outside 지표와 최대화 화면 비교를 함께 수행한다.
   - 장기안: arXiv LaTeX가 정상적으로 존재하는 논문은 텍스트 노드만 번역하고 XeLaTeX/LuaLaTeX로 한국어판 PDF를 재컴파일한다. 컴파일 실패 시 현재 PDF overlay로 fallback한다.

2. **문장/좌표 품질을 다양한 PDF에서 회귀 검증**
   - 2단 컬럼, 회전 텍스트, ligature, 각주, 참고문헌, 표 내부 텍스트, 줄바꿈 하이픈을 corpus로 모아 테스트해야 한다.
   - 현재 폭은 PDF item width 비율을 사용하므로 kerning이나 복잡한 glyph transform에서는 여전히 몇 픽셀 오차가 날 수 있다.
   - segment ID 안정성을 버전 간 유지하는 migration 전략도 필요하다.

3. **피겨 자동 경계 인식 정밀화**
   - 현재 LaTeX `includegraphics`, PDF 캡션 순서, PDF image paint transform을 결합한 1차 자동 인식이 구현되어 있다.
   - 여러 `includegraphics`가 한 figure 환경에 포함된 subfigure, vector-only plot, EPS/PGF/TikZ는 완전하지 않다.
   - 캡션과 이미지의 geometry/order matching score를 추가하고 실제 source figure 파일 여러 개를 composite preview로 만드는 작업이 필요하다.

### P1 — 핵심 제품 기능

4. **피겨를 AI에 실제 이미지 입력으로 전달**
   - provider별 멀티모달 CLI 입력 형식을 조사해 이미지 파일/바이트를 구조를 잃지 않고 전송한다.
   - 문장+수식+피겨 여러 개를 한 질문에 넣고 관계를 묻는 통합 테스트가 필요하다.

5. **앵커 기반 노트와 Obsidian 연결**
   - `paperId + stable anchorId`를 Markdown block ID 또는 별도 annotation index에 연결한다.
   - 각 문장/수식/피겨에서 바로 노트를 만들고 원문 위치로 돌아갈 수 있게 한다.
   - `[[paper]]`, related papers, concept tags, backlinks, 논문 간 graph를 설계한다.
   - 논문 폴더를 이동해도 깨지지 않도록 절대 경로 대신 라이브러리 상대 경로를 사용한다.

6. **태그 UX 추가 고도화**
   - 자동완성, 논문 ID 표기, 전송된 칩의 원문 이동은 구현됐다.
   - 현재 자동완성 catalog는 활성 논문 중심이므로 열려 있는 모든 논문의 `anchors.json`을 합쳐 검색하도록 확장해야 한다.
   - 자동완성 키보드 위/아래 이동과 Enter 선택, 동일 라벨의 논문별 명시적 qualified syntax를 추가해야 한다.

7. **백그라운드 번역 작업 관리**
   - 앱 재시작 후 중단된 batch 재개, 명시적 취소, 실패 batch 재시도, 작업 큐가 필요하다.
   - 여러 논문 동시 번역의 concurrency와 CLI rate limit 정책을 정해야 한다.

### P2 — 배포와 유지보수

8. **macOS 실제 검증과 배포**
   - 앱 아이콘과 macOS 한글 IME·Codex 로그인 판별 핫픽스는 반영됐다.
   - Intel/Apple Silicon에서 새 DMG 재테스트, 아이콘 표시 확인, code signing, notarization이 필요하다.

9. **Windows 설치 경험**
   - portable EXE 아이콘은 추가됐다. installer, 바로가기, 자동 업데이트가 필요하다.

10. **자동화 테스트와 보안**
    - 문장 분할/LaTeX parser/검색 ranking/번역 JSON parser 단위 테스트가 없다.
    - Electron CSP 경고를 제거하고 외부 URL 및 다운로드 제한을 재검토한다.
    - session에 thumbnail data URL을 저장하므로 대량 피겨 태그 시 15MB 제한에 빨리 도달할 수 있다. thumbnail 파일 경로나 별도 attachment store로 옮겨야 한다.

## 8. 구현 시 지켜야 할 결정

- 사용자 논문 데이터와 노트는 선택한 로컬 라이브러리 밖으로 임의 전송하지 않는다.
- 채팅 모델과 번역 모델 설정은 분리한다.
- 수식 자체는 번역하지 않는다.
- 문장, 수식, 피겨는 화면용 라벨과 별개로 안정 ID를 유지한다.
- AI로 넘길 때 단순 문자열 `@문장36`만 보내지 말고 구조화된 anchor metadata를 함께 보낸다.
- arXiv LaTeX가 있으면 우선 사용하되, 없거나 파싱/컴파일에 실패하면 PDF 기반 파이프라인을 유지한다.
- 논문/노트 경로는 Windows/macOS 모두를 위해 Node `path` API와 라이브러리 상대 경로를 사용한다.
- 의미 있는 작업 단위가 끝날 때마다 `kys_enhanced` 브랜치에 로컬 커밋한다. `git push`와 온라인 macOS 빌드/업로드는 사용자가 명시적으로 요청할 때만 수행한다.
- 사용자가 만든 파일이나 unrelated working-tree 변경은 덮어쓰지 않는다.

## 9. 다음 대화에 전달할 시작 프롬프트 예시

연구 지식 시스템과 Markdown 편집기 작업을 시작할 때는 먼저 `docs/RESEARCH_KNOWLEDGE_SYSTEM.md`를 읽는다. 이 문서에는 Paper/Concept/Claim/Insight/Question 모델, PDF 근거 링크, 시각 편집기, 개인 템플릿, Obsidian 비종속 호환 구조와 단계별 구현 기준이 정리되어 있다.

```text
Prism 저장소의 kys_enhanced 브랜치에서 계속 작업해 줘. 먼저 HANDOFF.md, docs/UX_REVIEW.md와 README.md를 읽고 git status를 확인해. 현재 한국어판은 실제 재컴파일 PDF가 아니라 PDF canvas 위 번역 overlay라는 점을 전제로, UX_REVIEW의 미완료 항목과 HANDOFF.md의 P0부터 진행해. 의미 있는 단위마다 kys_enhanced에 로컬 커밋하고, push와 온라인 macOS 빌드는 내가 명시적으로 요청할 때만 해.
```
