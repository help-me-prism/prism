# 연구 지식 시스템 구현 상태

이 문서는 `RESEARCH_KNOWLEDGE_SYSTEM.md`의 요구사항을 실제 코드와 회귀 테스트에 연결하는 작업표다. 완료 표시는 자동 테스트뿐 아니라 비단순 UI의 Electron 화면 확인까지 끝난 경우에만 붙인다.

## 완료된 기반

| 범위 | 상태 | 검증 근거 |
| --- | --- | --- |
| 읽기 / Live Edit / 분할 편집과 Markdown round-trip | 완료 | `npm run test:notes-ui`, `notes-live-edit.png`, `notes-document-blocks.png` |
| 툴바와 `/` 블록 삽입, 표·수식·이미지·코드·callout | 완료 | `npm run test:notes-ui`, `notes-document-blocks.png` |
| 원자적 저장, 외부 변경 감지, 충돌 비교 | 완료 | `scripts/test-vault-compatibility.mjs`, `notes-conflict.png` |
| Markdown 템플릿 CRUD와 타입별 기본값 | 완료 | `notes-templates.png` |
| 구조화 속성, 여섯 지식 노드 유형 | 완료 | `notes-knowledge.png` |
| 내부 링크 자동완성, 백링크, 타입 관계 | 완료 | `notes-link-autocomplete.png`, `notes-typed-relations.png` |
| 문장·수식·표·피겨·페이지 근거 카드 | 완료 | `notes-evidence-promotion.png` |
| PDF 왕복 이동, 역방향 근거 백링크, 재연결 | 완료 | `npm run test:notes-ui` |
| Claim / Insight / Question 승격과 근거 보존 | 완료 | `notes-evidence-promotion.png` |
| 로컬 관계 그래프와 연구 현황 데이터 보기 | 완료 | `notes-local-graph.png`, `notes-knowledge-data-views.png` |
| Obsidian 파일·제목·block 이동과 경로 호환 | 완료 | `npm run test:notes-ui`, `notes-obsidian-navigation.png` |
| 전문·로컬 임베딩·그래프 근거 검색 | 완료 | `notes-full-text-search.png` |
| AI 중복·관계·공백 제안과 승인/거절 | 완료 | `notes-ai-suggestions.png`, `notes-ai-relation-review.png` |
| 로컬 MCP 일곱 도구와 Reader 앵커 이동 | 완료 | `npm run test:mcp` |

## 구현 묶음

### A. 템플릿 수명주기 — 완료

- 즐겨찾기와 최근 사용 템플릿을 화면에 제공한다.
- 생성 노트에 재현 가능한 `template_version`을 기록한다.
- 기존 노트에 사용자가 고른 템플릿의 누락된 섹션만 추가하고 기존 본문은 바꾸지 않는다.
- `title` 외 기본 변수도 노트 생성 화면에서 필요한 값만 선택적으로 채울 수 있게 한다.

검증: `npm run test:notes-ui`, `npm run test:mcp`, `npm run test:ui`, `notes-template-lifecycle.png`, `notes-template-missing-sections.png`.

### B. 편집기 안의 연결 작성 — 완료

- 지식 노트 본문에서 `@`로 현재 Vault의 PDF 근거를 검색하고 삽입한다.
- 링크 검색 결과가 없을 때 Concept 또는 Claim을 즉시 만들고 현재 노트에 연결한다.
- 내부 링크 hover 미리보기에 노드 요약과 PDF 근거 수를 표시한다.
- 링크를 추가하면서 선택적으로 관계 타입을 함께 지정한다.

검증: `npm run test:notes-ui`, `npm run test:mcp`, `npm run test:ui`, `notes-link-preview.png`, `notes-evidence-autocomplete.png`, `notes-inline-create.png`.

### C. 근거 카드 작업 — 완료

- 근거 카드를 다른 지식 노트에 충돌 없이 복사한다.
- 근거 카드에서 기존 Claim 연결과 관계 타입 변경을 수행한다.
- 관계 sidecar에 선택적인 직접 근거 앵커를 기록한다.
- 섹션 앵커를 근거 유형에 포함하고 PDF 왕복 이동을 검증한다.

검증: `npm run test:notes-ui`, `npm run test:mcp`, `npm run test:ui`, `notes-evidence-copy.png`, `notes-evidence-claim.png`, `notes-section-evidence.png`.

### D. 블록 상호작용 — 완료

- Live Edit에서 커서 밖의 표·수식·이미지·코드·구분선을 문서 블록으로 렌더링하고, 블록을 누르면 해당 Markdown 원문을 편집한다.
- 체크박스는 문서형 화면에서 직접 누르며 `[ ]` / `[x]` Markdown을 저장한다.
- 시각 편집기에서 Markdown 블록 순서를 드래그로 바꾼다.
- 제목 아래 섹션을 접고 펼치되 접힘 상태는 파생 UI 상태로만 저장한다.
- Windows Ctrl / macOS Cmd 실행 취소·다시 실행과 붙여넣기 회귀를 명시적으로 검증한다.

검증: `npm run test:notes-ui`, `notes-document-blocks.png`, `notes-section-fold.png`, `notes-block-drag.png`, 실제 Electron Ctrl/Cmd 입력 이벤트, OS 클립보드의 다중 행 Markdown 붙여넣기.

### E. 연구 현황 확장과 완료 감사 — 완료

- 충돌하는 논문과 프로젝트별 개념·아이디어 문맥을 로컬 보기에 추가한다.
- Paper 읽기 상태를 읽을 예정 / 읽는 중 / 읽음 / 보류 선택값으로 분리한다.
- 같은 Vault의 Windows/macOS 경로 계약과 패키지 빌드를 다시 확인한다.
- Windows의 일시적 `EPERM`/`EBUSY`/`EACCES` 파일 점유에서 원자 교체를 재시도하고 임시 파일을 정리한다.
- 모든 항목 완료 후 `RESEARCH_KNOWLEDGE_SYSTEM.md`의 1차 완료 기준을 처음부터 재검증한다.

검증: `npm run test:notes-ui`, `npm run test:mcp`, `npm run test:ui`, `npm run test:structure`, `npm run package:win`, `node scripts/smoke-packaged-launch.mjs "release/Prism 0.1.0.exe"`, `notes-paper-reading-status.png`, `notes-knowledge-data-views.png`.

Windows에서는 portable EXE를 새로 만들고 패키지 안의 renderer가 실제로 열리는 것까지 확인했다. macOS는 Windows에서 DMG를 교차 생성하지 않으며, `package:mac:x64`와 `package:mac:arm64`를 각각 네이티브 GitHub Actions runner에서 실행하도록 구성되어 있다. 이번 로컬 감사에서는 macOS 실행 스크립트, `/` 상대 경로 저장, URI 인코딩, heading/block target 계약을 확인했으며 실제 Mac의 DMG 실행·서명·notarization은 배포 검증 항목으로 남는다.

## 1차 구현 완료 기준 감사

| 완료 기준 | 상태 | 검증 근거 |
| --- | --- | --- |
| Markdown 문법 없이 논문 노트 작성 | 완료 | 읽기 / Live Edit / 분할 모드, 툴바와 `/` 삽입, 문서형 블록 편집, `notes-document-blocks.png` |
| 개인 템플릿 저장과 새 노트 자동 적용 | 완료 | Markdown 템플릿 CRUD, 기본값, 버전, 즐겨찾기·최근 사용, 누락 섹션 적용 |
| 속성과 관계를 선택 UI로 지정 | 완료 | 상태·중요도·확신도·읽기 상태 select, 타입 관계 생성·검토 UI |
| 문장·수식·표·피겨 근거 카드 삽입 | 완료 | Reader와 Notes 양쪽 삽입, `notes-evidence-copy.png` |
| 근거 카드에서 PDF 원위치 이동 | 완료 | 문장·수식·표·피겨·페이지·섹션 anchor 왕복 테스트 |
| Claim / Insight 승격 시 원래 근거 유지 | 완료 | 승격된 Markdown과 anchor backlink 회귀, `notes-evidence-promotion.png` |
| Obsidian에서 본문과 링크를 읽고 수정 | 완료 | 일반 Markdown/YAML/wiki link/block ID 저장 및 file/heading/block URI 테스트 |
| 외부 수정 감지와 사용자 내용 보호 | 완료 | hash 충돌 감지, 일시적 Windows 파일 점유 재시도, 원자 저장, 비교·선택 UI, `notes-conflict.png` |
| Windows/macOS에서 동일 Vault 사용 | 완료(경로 계약) | `scripts/test-vault-compatibility.mjs`, `/` 상대 경로, OS별 실행·패키지 구성 |

설계안의 Phase 1~5와 1차 구현 완료 기준은 코드 및 로컬 회귀 기준으로 완료됐다. 이후 작업은 실제 macOS 배포 검증, 대규모 Vault 성능, 더 다양한 PDF corpus, 코드 서명처럼 운영·품질 범위를 확장하는 후속 단계다.

## 작업 규칙

각 알파벳 묶음은 필요하면 더 작은 계약/기능 커밋으로 나눈다. 기능 커밋 전후에 담당 영역 테스트를 실행하고, 비단순 UI는 `tmp/ui` 캡처를 직접 확인한다. 온라인 push와 배포는 사용자가 명시적으로 요청할 때만 수행한다.
