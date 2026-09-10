# Round 1 — engineering graduate-student screen review

Date: 2026-09-09. Persona: Korean-native, first-year engineering graduate student; comfortable with PDFs, unfamiliar with ontology, sensitive to AI usage.

This is an agent conducting an actual screen-driven walkthrough, not an interview with a human participant. Native Windows screenshots and `sky` mouse/keyboard inputs drove every product action. CDP was used only to save final screenshot artifacts. No production code was changed by this reviewer.

## Environment and task

- Isolated Electron profile, CDP port 9351; persistent fixture described in `tmp/persona-session.json`.
- Approximately 1280 × 900 reader window, dark mode.
- Paper: *Flow Matching for Generative Modeling*, arXiv 2210.02747.
- Translation was an existing cache supplied with the fixture, not a new translation call and not proof of the current translation harness quality.
- One real short chat was submitted using visibly selected **GPT-5.6-Luna**. No full-paper translation was launched.
- No authentication or real-user file changes. The review created one concept note and saved one answer in the isolated vault.

## Observed task results

1. Initial paired original/Korean reading mode clipped both pages horizontally at 100%. Switched to Korean-only mode to read comfortably.
2. Opened a new conversation using the sidebar `+`. The panel appeared after rendering settled. An earlier immediate screenshot incorrectly suggested this did nothing; that initial report was corrected. Existing conversation-row behavior was not conclusively tested.
3. Asked: “플로우 매칭이 시뮬레이션 없이 학습된다는 뜻을 초록 근거로 3문장만 설명해줘. 근거 쪽수도 알려줘.”
4. Received a real Luna answer distinguishing simulation-free training from ODE-based sampling, with page-one/abstract references. It gave three numbered statements after a preamble. The preamble and first numbered item were visually run together. Citation text was plain text, not an obvious source navigation action.
5. Clicked `노트에 저장`; success feedback named the Flow Matching paper note.
6. Clicked sidebar `노트`. A separate Notes window opened without selecting the saved-to paper. Manually selected that paper and scrolled to its memo section.
7. Found the answer collapsed into a single `AI 답변 · ... codex/gpt-5.6-luna` header and `…5줄 접힘`. Clicking the fold marker did not expand it, including after a fresh settled screenshot. The saved answer could not be read through that visible affordance.
8. Created concept **시뮬레이션 없는 학습** using `+` beside `concepts`; selected the Flow Matching paper via the `링크` toolbar. The link was inserted above the heading and the graph updated to two connected nodes.
9. Clicked `내 말로` and typed: “학습할 때 전체 ODE 궤적을 풀지 않고 목표 벡터장을 회귀한다. 샘플 생성에는 ODE 풀이가 필요할 수 있다.” Autosave reached `저장됨`.
10. Clicked the paper wikilink, observed the concept backlink on the paper note, then `리더에서 열기` returned to the paper. This basic knowledge-to-source round trip worked.

## Findings ordered by impact

| Severity | Screen-observed issue | User impact | Acceptance criterion for next round |
|---|---|---|---|
| P1 | Paired reading at default 100% clips both original and Korean prose horizontally. | Every line requires horizontal scrolling; comparison is impractical. | Default fit original to pane and reflow Korean to available width; no clipped prose at ordinary laptop sizes, including with chat open. |
| P1 | Saved AI answer is folded behind an inert `…5줄 접힘` marker. | Saving appears successful, but the knowledge cannot subsequently be read. | Mouse and keyboard expand/collapse reliably; reopening preserves content; newly saved result is easy to find. |
| P1 | Reader titlebar has no visible AI toggle beside the paper title; accessibility text includes `AI 대화 열기`. | The most direct question entry/close action is hidden. | A visible labelled question toggle remains outside Windows native caption controls at laptop width. |
| P2 | Saving an answer gives a tiny success label, while opening Notes starts an unselected three-pane workspace. | User must remember the destination title, find it, scroll past template sections, and discover the collapsed answer. | Save offers a direct open/jump action into the saved answer or relevant note, with source context retained. |
| P2 | Existing Korean reflow has `F LOW M ATCHING`, `A BSTRACT`, author raster fragments, and stray `Q.`. | The first screen feels like damaged extraction and reduces trust before reading. | Headings are normalized; author/artifact blocks are grouped or omitted from prose without losing the original page. |
| P2 | First short chat shows context meter around 22.9K, later 25.5K tokens. | Budget-sensitive student sees a large unexplained context for a three-sentence question. This is a context-display observation, not a measured billing total. | Compact task-specific context, low reasoning default, and understandable usage feedback; verify actual invocation context rather than just renaming the meter. |
| P2 | Notes sidebar exposes `papers`, `concepts`, `claims`, `questions`, `projects` immediately, with empty groups and a graph pane. | Ontology novice must infer a taxonomy before experiencing value. | Plain-language labels and a short task-led path from a useful passage to one connected concept. |
| P2 | Plain wikilink creates an edge, but no obvious flow explains how to express the relationship’s meaning. | User achieves a graph of mentions but not a clear ontology of definitions, supporting evidence, or open questions. | Introduce an optional meaningful relation at the moment of linking; show its meaning and direction clearly. |
| P3 | `메모 남기기` opens two small fields for a short memo and a concept, plus an empty related-notes area. | User is unsure whether to summarize, define, or create a note first. | One clear primary text field, understandable destination, and optional concept extraction/connection after capture. |

## Evidence and limitations

- `tmp/ui/round1-engineering-chat-wait.png`: actual question in progress.
- `tmp/ui/round1-engineering-answer.png`: completed real Luna answer with saved-to-note feedback.
- `tmp/ui/round1-engineering-backlink.png`: source paper note with the newly created concept backlink and graph edge.
- The initial paired-mode clipping and inert fold were also directly visible in native tool screenshots during the walkthrough. They were reported immediately to the parent agent.
- An immediate post-input screenshot can precede React/Electron paint. Findings above were checked after later settled observations; the new-chat false negative was explicitly discarded.
- During scrolling, one click landed on the moving `아직 모르겠는 것` quick-section control and added an empty section. This was a review timing artifact, not counted as a product defect.
- The engineering walkthrough alone does not establish usability for biology, unfamiliar file import, macOS, scanned PDFs, or a real multi-paper research project. Those require separate screen rounds.

## Fix-round handoff

The parent reported fixes in progress for pane fit/reflow, titlebar safe space, compact low-effort chat context, Notes labels/onboarding, and the inert fold widget. These are **reported implementation changes, not verified here**. Re-run the acceptance criteria on the rebuilt app and additionally check that the saved answer and concept survive the restart.
