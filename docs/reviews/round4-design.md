# Round 4 — dedicated UX/UI review of paper-format translation

2026-09-09. Actual native Windows screen review, 1280×900, dark chrome, updated isolated persona build launched as PID 24132 / CDP 9351. All product actions used the Computer Use sky API; screenshots were saved as review artifacts. The agent reviewed the user's supplied original/Korean comparison screenshot before this pass. This is an agent-led walkthrough, not a human usability study.

**Decision: do not approve this build as the completed format-preserving reader.** Complete math/table/figure rendering improved materially, but there are unresolved page-navigation and readability blockers. This decision is based on actual screens, not test status.

## Task and actual sequence

1. Opened the resumed engineering foamed-concrete PDF in paired original / `원문 형식` Korean view. Only page 4 had cached translation; this review made no AI calls.
2. On page 1, observed nontranslated English metadata rendered again as enlarged prose. `RESEARCHARTICLE` split into `RESEARC / H / ARTICLE`; `Abstract` split into `Abstra / ct`. The publication sidebar became a very long narrow column.
3. Clicked next page with scroll sync enabled. A settled recheck still showed page 1, while the Korean scroll position moved. Disabled scroll sync, then page arrows successfully reached pages 2, 3 and 4 after settling.
4. Compared engineering page 4: table rows were contiguous in one crop, and both display equations appeared as complete formulas instead of fragmented pieces. Text followed the expected table → paragraph → equation 1 → paragraph → equation 2 order.
5. Switched to Korean-only. At 100%, the translated page remained approximately 612px wide centered inside a roughly 1040px reader. Scrolled through the second equation, dimensions/temperature paragraph, complete preparation-process figure and translated caption.
6. Opened chat. The single Korean page still fit and its content remained readable. No question was submitted; the panel retained the previous Flow Matching conversation.
7. Deliberately selected side-by-side comparison with chat open. After rendering settled, the toolbar and Korean view showed page 6 while the original showed pages 2–3. Before this transition, the user had been reading translated page 4. Scroll sync was disabled. This is a source-page restoration failure on layout change, not just an expected difference in translated page height.
8. Stopped native interaction and handed the screen back for fixes. Biology format layout, latest block-based sync changes, light mode, keyboard mode switching and a wide desktop viewport were not tested in this pass.

## Findings

| Priority | Finding | Evidence / acceptance |
|---|---|---|
| P0 | Switching Korean-only p4 → comparison with chat open loses page context, even with sync off. Toolbar/AI scope p6, Korean p6, original p2–3. | [Screen](../../tmp/ui/round4/compact-compare-page-mismatch.png). Preserve source page/block before rerender; temporarily suppress observer-driven page changes until restoration settles. Recheck current-page AI scope after every layout transition. |
| P1 | Untranslated prose is unnecessarily retypeset into inflated narrow boxes in `원문 형식`. | Directly observed on engineering p1–3. Untouched blocks should remain original pixels or retain source-proportional typesetting; metadata must not become vertically exploded pseudo-translation. |
| P1 | Scroll-sync-on arrow navigation did not leave p1 in the first settled attempt. | Disabling sync enabled subsequent navigation. Parent already had replacement block-based sync in progress; it was not present/verified here. |
| P2 | Caption bounds use original English ink width instead of the associated visual width. | `표 1. 세 종류 섬유의 기본 특성` and `그림 2. FRFC의 제조 공정` break into unnecessary lines although large horizontal space is free. Associate caption layout width with its table/figure, while retaining safe ordering. |
| P2 | Korean format at 100% stays small in a wide single-reader pane; original has fit-width, Korean does not visibly offer it. | [Single view](../../tmp/ui/round4/engineering-p4-figure-single.png). Provide a truthful translated fit-width preset/default so equations and figures can use available space. Intentional fixed zoom should remain available. |
| P2 | Chat + deliberate compare produces two ~320px paper columns. | Original text is tiny and a horizontal scrollbar remains. Offer stacked comparison or a clear reading-focus action without abruptly closing a user-requested chat. Do not treat fitting a miniature page as sufficient readability. |
| P2 | Opening chat beside a different paper keeps an old answer while the context selector names the new paper. | Historical Flow Matching answer was visible beside engineering paper. This can be legitimate conversational history, but per-answer source labeling should make the distinction clear; no inference about wrong model grounding was made because no new question was sent. |

## Improvements verified visually

- Engineering p4 table is one complete crop with intact row/column alignment, not detached row strips.
- Both equations are complete, including fraction structure and equation numbers. This is a significant improvement over round 3.
- Figure 2 contains all preparation stages/material inputs/mold/hardened specimens in one image; translated caption follows it.
- Translated paragraph ordering around the equations is coherent; dimensions and ± temperature notation remain visible.
- Original horizontal structure is recognizable: wide table, inset body column, equations in body region and wider preparation figure. Adaptive vertical expansion does not overlap these inspected blocks.
- Single Korean mode with chat open fits within the pane and remains readable.

[Matched engineering p4 comparison](../../tmp/ui/round4/engineering-p4-compare.png)

## Comparison with the user reference

The user reference conveys a paper-first experience with stable section/math landmarks across two pages. The new mode recovers more of that structure than free reflow. It still differs in three consequential ways: untranslated regions are distorted, the translated page can become much longer through oversized narrow typesetting, and comparison fails to hold the same source location across layout changes. Adaptive height itself is acceptable; these defects are not an unavoidable consequence of adaptive height.

The reference also has considerable toolbar clutter. The new implementation should not copy that density. Current bars still duplicate original/Korean choices across tab and layout controls. After page correctness is stable, consolidate the controls around `원문 / 한국어 / 비교` plus a single translation-format choice and task-scoped AI action.

## Required next pass

Rebuild with original-pixel fallback for untranslated blocks, corrected page/block restoration and fit-width handling. Repeat the exact failing transition: engineering cached p4 near figure → open chat → compare → single → next page, first with sync off and then on. Confirm both the actual displayed source page and current translation scope. Check a two-column biology page and a full-width figure spanning two columns. Finally repeat a long translated paragraph near a protected equation/table, ensuring no overlap, loss or unreadable shrink.

Do not retroactively mark the present build as passed because the parent is implementing these fixes. Record the next build's outcomes separately.
