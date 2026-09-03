# 연구 DB v2 — 읽기와 정리를 분리한 지식 그래프

2026-09-03, 브랜치 `feat/research-db`. `RESEARCH_KNOWLEDGE_SYSTEM.md`의 1차 구현 위에 아래 원칙으로 구조를 다시 잡았다.

## 왜 바꿨나

1차 구현은 기능이 넓었지만 실제 Vault에는 Concept 1개, Claim 0개, 관계 0개였다. 원인은 셋이다.

- 논문 노트가 두 개로 갈라져 있었다. 읽으며 쓰는 `papers/<id>/<id>.md`는 지식 노드가 아니었고, 관계를 걸려면 `Papers/`에 Paper 노드를 따로 만들어야 했다.
- 캡처가 Notes 창 안에서만 가능했다. 읽다가 바로 담거나 채팅 답변을 보내는 길이 없었다.
- 온톨로지는 넓고 정리 흐름은 없었다. `related` 엣지, Insight/Project 노드가 있었고, 스텁 승격이나 대기열이 없었다.

## 원칙

- **노드·엣지 타입은 실제로 던질 쿼리가 있을 때만 존재한다.** 쿼리가 없으면 필드이거나 본문이다.
- **읽는 중에는 구조화하지 않는다.** 읽기는 선형 노트, 구조화는 대기열에서 배치로.
- **링크는 공짜, 노트는 가치가 증명된 뒤에.** `[[개념]]`은 빈 스텁만 만들고, 백링크 2개 이상일 때 대기열에 뜬다.
- **provenance 2계층.** 사용자가 승인한 것만 Markdown·검색·기본 그래프에 반영된다. AI 제안과 인용 그래프는 별도 레이어다.
- **주장 문장은 사용자가 쓴다.** 모델은 어느 메모가 Claim감인지 가리키기만 한다.

## 모델

| 노드 | 파일 | 비고 |
| --- | --- | --- |
| Paper | `papers/<arxivId>/<arxivId>.md`, `prism_id: paper-<arxivId>` | 다운로드 시 기본 Paper 템플릿 적용, `status: inbox` |
| Concept | `Concepts/*.md` | 본문은 "정의 비교 표"가 중심. `status: inbox`면 스텁 |
| Claim | `Claims/*.md` | `claim_origin: paper \| mine` (Insight 흡수), `evidence_kind`, `scope_domain`, `scope_regime`, `scope_assumptions` |
| Question | `Questions/*.md` | `answers` 관계가 승인되면 열린 질문에서 빠짐 |

Project는 노드 대신 모든 노드의 `projects: [...]` 필드로 표현한다. 기존 Insight/Project 파일은 계속 읽는다.

엣지: `defines`/`uses` (Paper→Concept), `supports`/`contradicts`/`extends` (Claim↔Claim, Paper→Claim, Paper→Paper, Concept→Concept은 extends만), `raises`/`answers` (→Question), `mentions` (자동 전용, 기본 숨김). 자세한 표는 `shared/contracts/relations.md`.

Claim 간 `contradicts`는 `scope_domain`/`scope_regime`이 둘 다 있고 다르면 "조건 차이일 수 있음" 경고 후 확인을 받는다.

## 흐름

```text
읽는 중   Reader 우클릭 → 한 줄 메모 (+ 정의하는 Concept) → 논문 노트 ## Notes
          채팅 답변 "노트에 저장" → [!ai] callout (출처 표시)
          [[개념]] 입력 → 저장 시 inbox 스텁 자동 생성
읽음 표시 모델이 노트를 읽고 관계·승격 힌트·새 Concept 제안 (전부 검토 대기)
정리      Notes 창 "정리" 대기열에서 승인/승격/병합/거절만 결정
          승격: 메모 → Claim/Question (근거 카드·출처 링크 유지, 논문 노트에 → 링크 표시)
탐색      Notes 창 오른쪽 연결 패널 (백링크·관계·인용 자동 레이어), 로컬 그래프 1~2홉 + 타입/관계 필터
```

## 저장 구조 추가분

```text
.prism/
  suggestions/<paperNodeId>.json   모델 제안 실행 기록과 거절 상태
  citations/<arxivId>.json         Semantic Scholar 참고문헌·피인용 캐시 (7일)
```

`library.json`의 절대 경로는 폴더가 이동·동기화됐을 때 현재 라이브러리 아래로 재배치해 읽는다.

## 검증

- `npm run test:capture` — 캡처, 스텁, 대기열, 승격, 병합, 정의 표, 모델 제안 파이프라인(가짜 CLI), 인용 캐시.
- `npm run test:notes-ui` — 기존 회귀에 더해 연결 패널, Reader/채팅 캡처의 노트 반영, 대기열에서의 Claim 승격, 미설정 모델 제안 거부.
- `node scripts/capture-research-ui.mjs <library>` — 실제 논문이 있는 라이브러리 사본으로 화면을 캡처해 `tmp/ui/research-*.png`로 저장한다. 절대 실제 Vault 경로를 넘기지 말 것.

## 남은 것

- Reader에서 우클릭 없이 키보드만으로 담는 단축키.
- 모델 제안을 논문 하나가 아니라 대기열 전체(예: 스텁 정의 비교 표 초안)에도 적용할지 결정.
- 대규모 Vault에서 대기열 계산 비용(모든 노트를 읽음) 측정.
