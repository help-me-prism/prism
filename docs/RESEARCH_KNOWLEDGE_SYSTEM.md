# Prism 연구 지식 시스템 설계안

## 1. 문서 목적

Prism을 단순한 PDF 리더와 채팅 앱이 아니라, 논문에서 얻은 근거와 사용자의 생각을 장기간 축적하는 개인 연구 지식 시스템으로 발전시키기 위한 제품·데이터·편집 경험의 방향을 정의한다.

이 문서는 다음 요구를 하나의 구조로 통합한다.

- 논문을 읽으며 문장, 수식, 표, 피겨에 직접 필기한다.
- 필기를 개념, 주장, 아이디어, 질문으로 발전시킨다.
- 각 생각이 어떤 논문의 어떤 근거에서 출발했는지 역추적한다.
- Markdown 문법을 직접 작성하지 않아도 Notion이나 Obsidian처럼 편집한다.
- 개인이 만든 필기 양식을 새 노트에 자동 적용한다.
- 정해진 값은 자유 입력 대신 버튼, 선택 메뉴, 칩으로 입력한다.
- Prism만으로 모든 기능을 사용할 수 있으면서 같은 자료를 Obsidian에서도 연다.
- 향후 AI가 사용자의 연구 지식을 검색하고 연결하되, 출처와 사용자 생각을 구분한다.

## 2. 제품 방향

Prism과 Obsidian의 관계는 종속이 아니라 호환이어야 한다.

```text
Prism                  연구 자료를 읽고, 근거가 있는 지식을 작성·정제하는 작업대
Markdown 라이브러리   장기 보존되는 실제 데이터 원본
Obsidian               선택적으로 사용하는 외부 편집·백링크·그래프·데이터 보기 도구
AI                     검색, 요약, 관계·충돌 제안을 제공하는 연구 보조자
```

Obsidian이 없어도 Prism의 작성, 편집, 검색, 연결, 그래프 기능이 완전하게 작동해야 한다. Obsidian을 설치한 사용자는 같은 Markdown 라이브러리를 Vault로 열어 기존 생태계와 AI 도구를 추가로 활용할 수 있어야 한다.

## 3. 핵심 설계 원칙

### 3.1 Markdown-first, UI-first

- 데이터는 사람이 읽을 수 있는 Markdown과 단순한 YAML 속성으로 저장한다.
- 사용자는 Markdown 문법을 몰라도 시각적 인터페이스로 작성할 수 있어야 한다.
- Prism 에디터가 만든 문서는 일반 텍스트 편집기와 Obsidian에서도 읽고 수정할 수 있어야 한다.
- Prism 전용 데이터가 본문을 대체해서는 안 된다.

### 3.2 근거 우선

- 논문에 관한 주장과 개인 아이디어는 가능한 한 원문 근거를 가져야 한다.
- 근거는 논문 전체가 아니라 정확한 문장, 수식, 표, 피겨, 섹션 또는 페이지를 가리킨다.
- 링크를 누르면 PDF 원위치로 이동하고 해당 구조를 강조한다.
- PDF 구조에서 역으로 이를 참조하는 필기와 주장을 확인할 수 있어야 한다.

### 3.3 점진적 구조화

- 모든 밑줄과 짧은 메모를 독립 노드로 만들지 않는다.
- 처음에는 논문 안의 가벼운 필기로 기록한다.
- 반복해서 쓰이거나 독립적인 가치가 생긴 필기만 아이디어, 주장, 개념, 질문으로 승격한다.
- AI는 승격과 연결을 제안할 수 있지만 자동 확정하지 않는다.

### 3.4 사용자 작성 내용 보호

- 사용자의 본문은 AI나 템플릿 업데이트가 자동으로 덮어쓰지 않는다.
- AI 생성 내용은 명확히 표시된 재생성 가능 영역 또는 초안으로 저장한다.
- AI가 만든 관계는 `검토 필요` 상태로 시작하며 사용자가 승인해야 확정된다.

### 3.5 파생 데이터 분리

- Markdown, PDF, 이미지와 사용자가 승인한 관계가 원본이다.
- 전문 검색 인덱스, 임베딩, 백링크 캐시와 화면 상태는 언제든 재생성할 수 있는 파생 데이터다.
- 파생 데이터가 없어져도 개인 필기와 지식 관계가 사라지면 안 된다.

## 4. 지식 모델

### 4.1 핵심 노드

| 노드 | 역할 | 예시 |
| --- | --- | --- |
| Paper | 출처와 논문 단위 독서 기록 | Denoising Diffusion Probabilistic Models |
| Concept | 여러 문서에서 반복되는 안정적인 개념 | Reverse diffusion, Self-attention |
| Claim | 참·거짓 또는 지지·반박을 논할 수 있는 명제 | 노이즈 예측은 가중 score matching으로 해석할 수 있다 |
| Insight | 사용자의 해석, 연결, 가설 | DDPM 목적함수와 masked modeling 사이의 유사성 |
| Question | 아직 해결하지 못한 연구 질문 | 시간 단계별 가중치가 생성 품질에 미치는 영향은 무엇인가? |
| Project | 현재 연구 목적과 필요한 지식을 묶는 문맥 | Diffusion objective 개선 연구 |

Concept는 명사형 지식이고 Claim은 문장으로 검증할 수 있는 명제다. Insight는 사용자의 새로운 해석이므로 논문이 직접 주장한 내용과 구분한다.

가벼운 개인 필기는 별도 `Note` 노드로 만들지 않고 Paper의 Markdown 본문이나 PDF 앵커에 붙인 주석으로 유지한다. 반복해서 참조되거나 독립적인 가치가 생겼을 때만 Claim, Insight, Question으로 승격한다. 이렇게 해야 그래프가 임시 메모로 과밀해지지 않는다.

### 4.2 관계 타입

관계를 모두 `관련 있음`으로 저장하지 않고 의미를 제한된 집합으로 관리한다.

| 내부 값 | 화면 표시 | 허용하는 핵심 연결 |
| --- | --- | --- |
| discusses | 다룸 | Paper → Concept |
| presents | 제시함 | Paper → Claim |
| supports | 지지함 | Paper → Claim, Claim → Claim |
| contradicts | 반박함 | Paper → Claim, Claim → Claim |
| extends | 확장함 | Claim → Claim |
| related | 관련 | Paper → Paper, Concept → Concept, 그 밖의 임시 연결 |

관계에는 출발 노드, 대상 노드, 관계 타입, 생성자, 검토 상태, 근거 앵커와 생성 시각을 기록한다. AI 관계와 사용자 관계를 구분한다.

새 관계 UI는 출발·대상 노드 조합에 맞는 위 관계만 보여준다. 예를 들어 Paper에서 `다룸`을 선택하면 Concept만, `제시함·지지함·반박함`을 선택하면 Claim만 검색된다. 기존 Vault 호환을 위해 과거의 `uses`, `explains`, `evidence_for`, `derived_from`, `raises` 값은 계속 읽지만 새 기본 UI에서는 노출하지 않는다.

### 4.3 PDF 근거 앵커

문장, 수식, 표, 피겨와 페이지에는 안정적인 ID를 부여한다.

```yaml
paper_id: paper-arxiv-2006.11239
anchor_id: equation-p4-3
anchor_type: equation
page: 4
source_hash: 83a4...
```

앵커는 가능한 한 PDF 좌표와 LaTeX 구조를 함께 보관한다. PDF 버전이나 레이아웃이 바뀌었을 때 `source_hash`와 주변 텍스트를 사용해 위치를 재연결한다.

## 5. 편집 경험

### 5.1 편집 모드

Prism Notes는 현재의 일반 textarea를 연구용 시각 편집기로 교체한다.

- **읽기 모드:** Markdown 문법 없이 완성된 문서처럼 표시한다.
- **Live Edit:** 커서 주변만 필요한 편집 표현을 보여주고 나머지는 렌더링한다.
- **분할 모드:** 왼쪽에서 편집하고 오른쪽에서 최종 결과를 확인한다.

기본값은 Live Edit로 한다. Markdown 원문 편집은 고급 사용자용 보조 모드로 제공한다.

### 5.2 지원 블록

- 제목과 본문
- 글머리표와 번호 목록
- 체크박스
- 인용과 callout
- 표
- 코드 블록
- 인라인 및 블록 LaTeX 수식
- 이미지와 논문 피겨
- PDF 근거 카드
- 내부 링크와 관계 카드
- 구분선과 접기 섹션

블록은 드래그로 순서를 바꾸고 `/` 명령이나 툴바에서 삽입한다. 붙여넣기와 실행 취소, 키보드 선택, Windows의 Ctrl과 macOS의 Cmd 단축키를 모두 지원해야 한다.

### 5.3 자유 입력과 선택 입력의 구분

서술이 필요한 곳만 텍스트로 입력하고 값의 범위가 정해진 곳은 UI로 선택한다.

선택형 입력의 예:

- 노드 종류: Paper / Concept / Claim / Insight / Question
- 관계: 관련 / 다룸 / 제시 / 지지 / 반박 / 확장
- 읽기 상태: 읽을 예정 / 읽는 중 / 읽음 / 보류
- 중요도: 낮음 / 보통 / 높음 / 핵심
- 확신도: 낮음 / 중간 / 높음
- 연결 생성자: 사용자 / AI
- AI 제안 상태: 검토 필요 / 승인 / 거절

화면에서는 버튼 그룹, 드롭다운, 자동완성 칩으로 표시하고 저장 시 안정적인 내부 값으로 변환한다. 사용자가 `supports` 같은 내부 문자열을 직접 입력할 필요는 없다.

### 5.4 내부 링크 작성

- `[[`를 입력하거나 `연결 추가` 버튼을 누르면 모든 지식 노드를 검색한다.
- Paper 노트의 `링크` 버튼에서는 논문명, arXiv ID, 저자, Concept, Claim을 한 번에 검색하고 클릭해 삽입한다.
- 자동완성 결과는 제목 일치, 제목 포함, ID·경로 일치, 본문 언급 순으로 정렬한다.
- `@`를 입력하면 현재 또는 열린 논문의 문장, 수식, 표, 피겨를 검색한다.
- 링크 생성 시 필요하면 관계 타입을 바로 선택한다.
- 아직 존재하지 않는 Concept나 Claim은 검색 창에서 즉시 생성할 수 있다.
- 링크에 마우스를 올리면 요약과 근거 수를 미리 보여준다.

### 5.5 슬래시 작업 명령

- `/관계`: 현재 노드에서 가능한 관계와 대상 검색을 연다.
- `/지지`, `/반박`: 관계 타입을 바로 선택하고 연결 가능한 Claim만 보여준다.
- `/링크`, `/근거`, `/그래프`: 각각 지식 검색, PDF 근거 선택, 로컬 그래프를 연다.
- 화살표 키로 후보를 이동하고 `Tab` 또는 `Enter`로 선택한다.
- 관계 타입은 버튼으로도 바꿀 수 있으며, 슬래시 명령 문자열 자체는 Markdown에 저장하지 않는다.

### 5.6 근거 카드

PDF에서 문장, 수식, 표 또는 피겨를 선택하고 `필기 추가`를 누르면 현재 노트의 커서 위치에 근거 카드가 삽입된다.

```text
┌ 수식 · DDPM p.4 Eq.3 ───────────────── ↗ │ × ┐
│ L_simple = E[||ε - εθ(x_t,t)||²]             │
└───────────────────────────────────────────────┘

이 목적함수는 score matching 관점에서 이해하는 것이 더 자연스럽다.
```

- 카드 클릭: PDF 원위치로 이동하고 강조한다.
- 카드 메뉴: 관계 변경, 다른 노트에 복사, Claim으로 승격한다.
- 삭제: 링크만 지우며 PDF 원문과 다른 필기는 보존한다.
- 원문이 변경된 경우: 끊어진 링크로 숨기지 않고 재연결 필요 상태를 표시한다.

## 6. 개인 필기 양식

### 6.1 템플릿의 역할

사용자는 노드 종류마다 기본 양식을 하나 이상 저장할 수 있다.

예시:

- 논문 정독 양식
- 논문 빠른 검토 양식
- 개념 정리 양식
- Claim 검토 양식
- 연구 아이디어 양식
- 프로젝트 회의 양식

새 노트를 만들 때 기본 템플릿을 자동 적용하고, 필요하면 생성 화면에서 다른 템플릿을 선택한다.

### 6.2 템플릿 예시

```markdown
---
type: prism-template
template_id: paper-deep-review
target_type: paper
---

# {{title}}

## 한 문장 요약

## 이 논문을 읽는 이유

## 핵심 주장

## 방법

## 주요 근거

## 한계와 의문

## 내 아이디어

## 관련 개념과 논문
```

지원할 기본 변수:

- `{{title}}`, `{{date}}`, `{{authors}}`, `{{year}}`
- `{{arxiv_id}}`, `{{doi}}`, `{{paper_link}}`
- `{{current_project}}`, `{{selected_anchor}}`

### 6.3 템플릿 관리 원칙

- 템플릿도 Markdown 파일로 저장해 사용자가 소유한다.
- 노드 타입별 기본 템플릿을 지정할 수 있다.
- 최근 사용 템플릿과 즐겨찾기를 제공한다.
- 템플릿 수정은 이후 생성되는 노트에만 자동 적용한다.
- 기존 노트에는 `누락된 섹션만 추가`를 명시적으로 실행할 수 있다.
- 템플릿 변경으로 사용자 본문을 덮어쓰지 않는다.
- 생성된 노트에 사용한 `template_id`와 버전을 기록한다.

## 7. 대표 사용자 흐름

### 7.1 논문을 읽으며 필기

1. 사용자가 PDF의 문장이나 수식을 선택한다.
2. `필기 추가`를 누른다.
3. 선택한 근거 카드가 노트에 삽입된다.
4. 카드 아래에 생각을 자연어로 작성한다.
5. 중요도, 필기 종류, 관련 개념을 버튼으로 지정한다.
6. 자동 저장된다.

### 7.2 필기를 지식으로 승격

1. 필기 카드의 `승격`을 누른다.
2. Claim / Insight / Question 중 하나를 선택한다.
3. Prism이 제목과 관련 개념을 제안한다.
4. 사용자가 확인하면 독립 Markdown 노드가 생성된다.
5. 원래 필기와 PDF 근거 링크가 새 노드에 유지된다.

### 7.3 기존 주장과 연결

1. 새 논문에서 근거를 선택한다.
2. `기존 Claim에 연결`을 누른다.
3. 의미 검색으로 관련 Claim을 찾는다.
4. `지지함`, `반박함`, `확장함` 중 하나를 고른다.
5. Claim 화면에 지지 근거와 반대 근거가 함께 누적된다.

### 7.4 연구 질문에 답하기

1. 사용자가 자연어로 질문한다.
2. Prism은 관련 Concept와 Claim을 먼저 찾는다.
3. 관계 그래프를 따라 지지·반박 논문을 찾는다.
4. 정확한 PDF 근거와 개인 필기를 회수한다.
5. 답변에서 원문, 사용자 생각, AI 추론을 구분해 표시한다.

## 8. 화면 구조

```text
┌ 지식 탐색 ─────┬──────────── 노트 편집기 ────────────┬ 연결된 지식 ────┐
│ Inbox           │ 제목 / 속성 버튼                    │ 관련 Concept     │
│ Papers          │                                    │ 지지 Claim       │
│ Concepts        │ 본문, 수식, 표, 근거 카드           │ 반대 Claim       │
│ Claims          │                                    │ PDF 근거         │
│ Insights        │ Markdown은 내부적으로 자동 저장     │ 백링크           │
│ Questions       │                                    │ AI 연결 제안     │
└─────────────────┴────────────────────────────────────┴─────────────────┘
```

전체 그래프보다 현재 문맥에 집중한 로컬 그래프를 우선한다.

- 현재 논문 주변 연결
- 특정 Claim의 지지·반박 근거
- 프로젝트에서 사용하는 개념과 아이디어
- 근거가 없는 Claim
- 서로 충돌하는 논문
- 아직 답하지 못한 Question

## 9. 저장 구조

```text
Research Vault/
├─ 00 Inbox/
├─ Papers/
│  └─ 2006.11239 - Denoising Diffusion.md
├─ Concepts/
│  └─ Reverse diffusion.md
├─ Claims/
│  └─ Noise prediction is weighted score matching.md
├─ Insights/
├─ Questions/
├─ Projects/
├─ Templates/
│  ├─ Paper - Deep review.md
│  └─ Claim - Evidence review.md
├─ Assets/
│  ├─ PDFs/
│  └─ Figures/
└─ .prism/
   ├─ anchors/
   ├─ relations/
   ├─ index/
   └─ cache/
```

### 9.1 Markdown 속성 예시

```yaml
---
type: claim
prism_id: claim-7e229a
status: developing
confidence: medium
concepts:
  - "[[Concepts/Score matching]]"
source_papers:
  - "[[Papers/2006.11239 - Denoising Diffusion]]"
projects:
  - "[[Projects/Diffusion study]]"
created_by: user
template_id: claim-evidence-review
---
```

YAML에는 검색과 분류에 필요한 짧고 원자적인 값만 둔다. 긴 설명, 근거 인용과 사용자 생각은 본문에 둔다. Obsidian Properties는 중첩 데이터와 속성 내부 Markdown에 제한이 있으므로 복잡한 관계 객체를 YAML 안에 억지로 넣지 않는다.

### 9.2 좌표와 관계 sidecar

- Markdown block ID와 PDF 앵커 좌표의 대응은 `.prism/anchors/<paper-id>.json`에 저장한다.
- 관계의 생성자, 검토 상태, 직접 근거처럼 Markdown 링크에 담기 어려운 정보는 `.prism/relations`에 저장할 수 있다.
- 관계의 양 끝은 반드시 안정적인 `prism_id`를 사용한다.
- 사용자에게 중요한 관계는 Markdown에도 일반 링크로 남겨 sidecar가 없어져도 의미를 읽을 수 있게 한다.

### 9.3 검색 인덱스

- 텍스트 검색, 임베딩, 백링크와 그래프 인덱스는 `.prism/index`에 둔다.
- 인덱스는 Markdown과 원문에서 재생성 가능해야 한다.
- 대용량 인덱스는 Git 동기화 대상에서 제외하고 각 기기에서 다시 만든다.
- 사용자가 승인한 관계와 개인 필기는 Git 또는 선택한 동기화 수단에 포함한다.

## 10. Prism과 Obsidian의 동시 편집

- Prism은 라이브러리의 외부 파일 변경을 감지한다.
- 저장 직전 파일 hash를 확인해 Obsidian에서 변경된 파일을 무조건 덮어쓰지 않는다.
- 자동 생성 영역만 갱신하고 사용자 영역은 보존한다.
- 충돌 시 Prism 버전과 디스크 버전을 비교하는 화면을 제공한다.
- 파일 저장은 임시 파일 작성 후 교체하는 원자적 저장을 사용한다.
- 경로는 Vault 기준 상대 경로와 `/` 구분자를 사용해 Windows와 macOS를 모두 지원한다.
- `Obsidian에서 열기`는 파일, 제목 또는 block 위치까지 이동할 수 있게 한다.

## 11. AI 연결 방향

AI는 Markdown 파일을 무차별적으로 전부 읽는 대신 그래프와 근거를 함께 검색해야 한다.

```text
사용자 질문
  → 관련 Concept/Claim 검색
  → 연결된 Paper와 Insight 탐색
  → supports/contradicts 관계 확인
  → PDF 원문 앵커 회수
  → 사용자 필기와 AI 추론을 분리해 답변
```

향후 Prism이 제공할 수 있는 로컬 API 또는 MCP 도구:

- `search_knowledge(query)`
- `get_claim_evidence(claim_id)`
- `find_related_concepts(concept_id)`
- `compare_papers(paper_ids)`
- `open_paper_anchor(anchor_id)`
- `suggest_relationships(node_id)`
- `create_note_draft(template_id)`

읽기와 검색은 자동화할 수 있지만 새 관계 확정, 기존 필기 수정과 삭제는 사용자 승인을 요구한다. 특정 Obsidian AI 플러그인에 종속되지 않고 다양한 AI 도구가 같은 로컬 지식에 접근할 수 있는 구조를 목표로 한다.

향후 논문 Reader의 채팅과 PDF 직접 필기는 동일한 PDF 앵커 계약을 사용한다. 채팅 질문·답변과 여백 필기는 먼저 Paper 본문 또는 앵커 주석으로 자동 반영하고, AI는 그중 재사용 가치가 있는 부분만 Claim, Insight, Question 승격 후보로 제안한다. 사용자 승인 전에는 독립 지식 노드나 관계를 자동 확정하지 않는다.

## 12. 구현 단계

### Phase 1 — 편집 기반

1. Notes textarea를 블록 기반 Markdown 편집기로 교체한다.
2. 읽기, Live Edit, 분할 모드를 제공한다.
3. 제목, 목록, 표, 수식, 이미지, callout을 지원한다.
4. 자동 저장, 실행 취소, 외부 변경 감지와 충돌 방지를 구현한다.

### Phase 2 — 템플릿과 구조화 입력

1. 개인 템플릿 생성·편집·복제·삭제 화면을 만든다.
2. 노드 타입별 기본 템플릿을 지정한다.
3. 관계, 상태, 중요도, 확신도를 버튼과 칩으로 편집한다.
4. Paper, Concept, Claim, Insight, Question 노트를 생성한다.

### Phase 3 — 논문 근거 연결

1. 문장, 수식, 표, 피겨를 노트에 근거 카드로 삽입한다.
2. 노트에서 PDF로, PDF에서 관련 노트로 양방향 이동한다.
3. 필기를 Claim, Insight, Question으로 승격한다.
4. 안정 ID와 끊어진 앵커 재연결을 구현한다.

### Phase 4 — 지식 탐색

1. 내부 링크 자동완성과 백링크 패널을 구현한다.
2. 관계 타입이 있는 로컬 그래프를 만든다.
3. 프로젝트, 미완성 질문, 근거 없는 Claim을 위한 데이터 보기를 만든다.
4. Obsidian에서 열기와 Vault 호환성을 검증한다.

### Phase 5 — 연구 AI

1. 전문 검색과 임베딩을 결합한다.
2. 그래프를 따라 근거를 찾는 검색을 추가한다.
3. 중복 개념, 지지·반박, 연구 공백을 제안한다.
4. 로컬 API/MCP를 통해 외부 AI 도구와 연결한다.

## 13. 1차 구현 완료 기준

- 사용자가 Markdown 문법을 입력하지 않고 논문 노트를 작성할 수 있다.
- 개인 템플릿을 저장하고 새 노트에 자동 적용할 수 있다.
- 정해진 속성과 관계를 버튼 또는 선택 메뉴로 지정할 수 있다.
- PDF 문장, 수식, 표, 피겨가 노트 안에 근거 카드로 들어간다.
- 근거 카드를 누르면 PDF 원위치로 이동한다.
- 필기를 Claim 또는 Insight로 승격해 원래 근거를 유지할 수 있다.
- Markdown 파일을 Obsidian에서 열어도 본문과 링크를 정상적으로 읽고 수정할 수 있다.
- Obsidian에서 수정한 파일을 Prism이 감지하며 사용자 내용을 덮어쓰지 않는다.
- Windows와 macOS에서 동일한 Vault를 사용할 수 있다.

## 14. 피해야 할 구현

- 모든 하이라이트를 자동으로 독립 파일로 만드는 것
- 모든 관계를 `related` 하나로 처리하는 것
- 주제를 모두 태그로만 표현하는 것
- 개인 필기를 앱 전용 JSON이나 데이터베이스에만 저장하는 것
- AI가 사용자 승인 없이 기존 노트와 관계를 수정하는 것
- 템플릿 업데이트가 기존 노트 본문을 덮어쓰는 것
- 전체 그래프를 유일한 탐색 화면으로 사용하는 것
- Obsidian 플러그인이 없으면 핵심 기능이 작동하지 않는 것

## 15. 다음 대화에서 결정할 항목

1. 사용할 블록 편집기 기반 기술과 Markdown round-trip 보존 수준
2. 노드 타입별 기본 템플릿의 구체적인 문항
3. Markdown 안에서 관계를 표현하는 형식과 sidecar의 책임 범위
4. Notes 기존 파일을 새 구조로 마이그레이션하는 방법
5. Prism 내부 탐색 UI와 Obsidian 호환 링크 규칙
6. Phase 1의 최소 기능 범위와 자동·시각 회귀 테스트 계획

## 16. 다음 대화 시작 프롬프트

```text
Prism 저장소의 kys_enhanced 브랜치에서 계속 작업해 줘. 먼저 HANDOFF.md와 docs/RESEARCH_KNOWLEDGE_SYSTEM.md를 전부 읽고 git status를 확인해. 연구 지식 시스템 설계안의 Phase 1부터 시작하되, 구현 전에 현재 Notes 구조와 저장 방식을 조사하고 Markdown round-trip을 보존할 편집기 기술을 비교해 가장 적절한 방안을 제시해. 사용자는 Markdown 문법을 직접 작성하지 않아도 되어야 하고, Obsidian이 없어도 모든 기능이 동작하면서 같은 Vault를 Obsidian에서도 안전하게 편집할 수 있어야 해. 의미 있는 작업 단위마다 kys_enhanced에 로컬 커밋하고 push와 온라인 빌드는 내가 명시적으로 요청할 때만 실행해.
```

## 17. 참고

- Obsidian Properties: https://obsidian.md/help/properties
- Obsidian Internal links: https://obsidian.md/help/links
- Obsidian Bases: https://obsidian.md/help/bases
- Obsidian URI: https://help.obsidian.md/Extending%2BObsidian/Obsidian%2BURI
