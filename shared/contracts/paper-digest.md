# Paper digest contract

## Use case

A note only gets written if writing it is nearly free. Prism already knows the paper and every chat the researcher had about it, so it drafts the mechanical parts of a paper note and leaves the one section that is actually theirs alone.

## Sections

| 섹션 | 누가 쓰나 | 내용 |
| --- | --- | --- |
| `## 한눈에` | 자동 | 초록에서 뽑은 3줄. 모델이 설정돼 있으면 문제·방법·결과로 다시 씀 |
| `## 내가 헷갈린 것` | 자동 | 이 논문 맥락의 채팅에서 **사용자가 한 질문**만. 반복하면 "N번 물어봄" |
| `## 내가 주목한 것` | 자동 | 사용자가 채팅에서 태그한 앵커를 참조 횟수 순으로 |
| `## 내 생각` | 사용자 | 자동 정리가 절대 건드리지 않음 |
| `## 메모` | 사용자·리더 | 리더 우클릭 캡처가 쌓이는 곳 |

## Generated regions

자동 구간은 `<!-- prism:auto <section> -->` … `<!-- /prism:auto <section> -->` 사이에만 쓰인다. 갱신은 이 구간을 통째로 교체하며 바깥은 한 글자도 바꾸지 않는다. 마커가 없으면 같은 제목의 섹션 아래에 넣고, 제목도 없으면 `## 내 생각` 앞에 새로 만든다. 즉 사용자가 쓴 글은 항상 아래에 남는다.

## 채팅 귀속

메시지는 두 경로로 논문에 연결된다.

- `ChatMessage.paperIds` — 전송 시점의 컨텍스트 논문, 참조한 앵커의 논문, 리더에서 열려 있던 논문.
- `ChatMessage.anchors[].paperId` — 예전 기록에도 있는 경로.

AI 답변은 요약·헷갈린 것 추출에서 제외한다. 헷갈린 것은 **사용자 문장에서만** 뽑는다. 한국어 어미 변화를 견디도록 질문은 어간 집합으로 비교해 같은 고민이면 하나로 묶고 횟수를 센다.

## IPC

`paper:digest:refresh` (paperNodeId, `{ useModel?: boolean }`) → `PaperDigestResult { updated, chatMessages, sections, usedModel }`.

- 노트를 열면 `useModel: false`로 한 번 자동 실행된다. 비용이 없고, 바뀐 게 없으면 파일을 쓰지 않는다.
- `useModel: true`는 사용자가 `자동 정리 갱신`을 눌렀을 때만. `knowledgeProvider`/`knowledgeModel` 설정을 쓴다.
- 모델 응답이 깨지면 결정적 결과를 그대로 쓴다. 모델은 있으면 좋고 없어도 동작한다.
- 노트가 그 사이 외부에서 바뀌었으면 저장하지 않고 오류를 낸다.
