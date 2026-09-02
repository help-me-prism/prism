# 연구 지식 시스템 구현 상태

이 문서는 `RESEARCH_KNOWLEDGE_SYSTEM.md`의 요구사항을 실제 코드와 회귀 테스트에 연결하는 작업표다. 완료 표시는 자동 테스트뿐 아니라 비단순 UI의 Electron 화면 확인까지 끝난 경우에만 붙인다.

## 완료된 기반

| 범위 | 상태 | 검증 근거 |
| --- | --- | --- |
| 읽기 / Live Edit / 분할 편집과 Markdown round-trip | 완료 | `npm run test:notes-ui`, `notes-live-edit.png` |
| 툴바와 `/` 블록 삽입, 표·수식·이미지·callout | 완료 | `npm run test:notes-ui` |
| 원자적 저장, 외부 변경 감지, 충돌 비교 | 완료 | `notes-conflict.png` |
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

## 남은 구현 묶음

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

### D. 블록 상호작용

- 시각 편집기에서 Markdown 블록 순서를 드래그로 바꾼다.
- 제목 아래 섹션을 접고 펼치되 접힘 상태는 파생 UI 상태로만 저장한다.
- Windows Ctrl / macOS Cmd 실행 취소·다시 실행과 붙여넣기 회귀를 명시적으로 검증한다.

### E. 연구 현황 확장과 완료 감사

- 충돌하는 논문과 프로젝트별 개념·아이디어 문맥을 로컬 보기에 추가한다.
- Paper 읽기 상태를 읽을 예정 / 읽는 중 / 읽음 / 보류 선택값으로 분리한다.
- 같은 Vault의 Windows/macOS 경로 계약과 패키지 빌드를 다시 확인한다.
- 모든 항목 완료 후 `RESEARCH_KNOWLEDGE_SYSTEM.md`의 1차 완료 기준을 처음부터 재검증한다.

## 작업 규칙

각 알파벳 묶음은 필요하면 더 작은 계약/기능 커밋으로 나눈다. 기능 커밋 전후에 담당 영역 테스트를 실행하고, 비단순 UI는 `tmp/ui` 캡처를 직접 확인한다. 온라인 push와 배포는 사용자가 명시적으로 요청할 때만 수행한다.
