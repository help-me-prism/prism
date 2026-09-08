# 논문 구조 맵 계약

리더는 한 논문에 대해 세 개의 창(원문 · 한국어 · 구조 맵)을 갖고, 구조 맵은 그 논문이 무엇을 어떤 순서로 주장하는지를 좌에서 우로 그린다. 볼트 전체 노트의 관계를 그리는 Notes 창의 **지식 그래프**와는 다른 화면이며, 서로의 코드를 공유하지 않는다.

| | 구조 맵 | 지식 그래프 |
| --- | --- | --- |
| 위치 | 리더의 세 번째 창 | Notes 창 탭 |
| 대상 | 논문 한 편의 섹션 | 볼트 전체 노트 |
| 배치 | 레이어드 DAG, 폭에 맞춰 줄바꿈 | force 레이아웃 |
| 코드 | `src/paper/`, `electron/paperStructure.ts` | `src/graph/`, `GraphView.tsx` |

## 무엇으로 만드는가

리더가 논문을 처음 열 때 저장하는 앵커(`papers/<arxivId>/anchors.json`, 사본은 `.prism/anchors/`)가 유일한 입력이다. 번호가 붙은 heading만 노드가 되고, 제목·초록·참고문헌·감사의 글은 논지가 아니므로 제외한다. 각 노드는 그 heading의 앵커 id를 들고 있어 클릭하면 리더가 그 페이지·문장으로 이동한다.

```ts
type StructureRole = 'problem' | 'background' | 'method' | 'component' | 'rationale' | 'experiment' | 'result' | 'limit'
type StructureEdgeType = 'then' | 'part' | 'needs' | 'supports' | 'branches' | 'contrasts'
type StructureOrigin = 'outline' | 'model'
```

- `outline` — 논문의 목차가 말하는 것. 대섹션은 `then`으로 이어지고 하위 섹션은 부모에 `part`로 붙는다. 역할은 제목 규칙으로 정하며, 특징 없는 하위 섹션은 부모의 역할을 물려받는다.
- `model` — 모델이 읽어낸 것. 역할·요약과 `needs·supports·branches·contrasts` 관계만 만들 수 있다.

## 모델이 할 수 있는 일과, 못 하게 막는 방법

`refinePaperStructure`는 두 번 묻는다. 먼저 섹션마다 역할과 한 줄 요약을(그 섹션의 문장을 인용해 보여주고), 다음에 확정된 노드 목록만 주고 관계를 묻는다. 두 답 모두 저장 전에 걸러진다.

- 논문에 없는 id, 역할이 아닌 역할, 자기 자신을 향한 관계, 이미 그려진 순서의 반복은 버린다.
- 앞뒤가 순환하는 관계는 버린다. 흐름으로 그릴 수 없고, 논문이 같은 섹션으로 가면서 동시에 그로부터 온다는 주장이기 때문이다.
- 한 번에 추가할 수 있는 관계는 8개까지다.
- 설명된 섹션이 절반에 못 미치면 **결과 전체를 버리고** 목차를 그대로 둔 뒤 이유를 `notes`에 적는다.

검증은 순수 함수(`parseRoleResponse`, `parseEdgeResponse`, `withoutCycles`, `mergeRefinement`)로 분리되어 있고 `scripts/test-paper-structure.mjs`가 각 관문을 가짜 응답으로 확인한다.

## 캐시

`.prism/structure/<arxivId>.json`. `sourceHash`는 목차(노드 id·앵커·제목)의 해시이므로 논문을 다시 분석하면 이전 실행은 자동으로 무효가 된다. 볼트의 Markdown에는 아무것도 쓰지 않는다 — Obsidian 호환은 그대로다. 읽을 때 `mergeRefinement`가 목차 위에 저장된 실행을 얹으며, 구조(어떤 섹션이 있는지, 어느 페이지인지)는 언제나 목차가 이긴다.

## IPC

- `paper:structure` — 목차를 만들고, 유효한 캐시가 있으면 얹어서 돌려준다. 모델을 부르지 않는다.
- `paper:structure:refresh` — 설정된 지식 CLI로 위 두 패스를 실행하고 요약을 돌려준다. CLI가 설정되지 않았으면 그렇게 말한다.

## 창 배치

배치는 `src/paper/panes.ts`의 트리(`{ dir, sizes, children }`, 잎은 탭 그룹)이고, 창 종류는 `original | translated | map`이다. 창은 논문 경계를 넘지 않으며, 논문별 마지막 배치는 렌더러의 `localStorage`(`prism.reader.layout.<arxivId>`)에만 저장한다. 저장된 배치가 있는 논문은 번역 캐시가 복원되어도 창이 임의로 열리지 않는다.
