# Returning directly to a saved answer

The preceding screen review found that saving an answer worked, but opening its note left the reader at the top. Finding the new answer required the memo-section control and another callout expansion. This round connects the saved answer to its exact editable block.

Each new capture returns a unique `ai-answer-…` marker. The chat action retains that marker alongside the original paper and vault. Opening the saved note carries the target through main-process ownership checks, the preload's initial-load buffer and the Notes document. The editor opens enclosing sections and the answer callout, then scrolls to its answer text. If an already open clean note has not observed the new file yet, navigation reads the latest snapshot once. Dirty editing is preserved rather than overwritten. Missing or ambiguous targets do not silently choose a different answer.

The marker uses the structured-block spacing documented in [Obsidian's internal-link documentation](https://obsidian.md/help/links): its own line with blank lines around it. This is a format check, not a claim of an independent Obsidian application test. Historical answers without a saved marker are not retroactively migrated by this change.

## Selected-source and popup readability

A programmatic source scroll could put another sentence under a stationary pointer. Its mouse-enter or leave callback replaced the explicit source highlight. Hover now respects the explicit navigation owner until a user scroll, pointer action or navigation key releases it. Actual sentence selection still takes ownership.

The independent taste reviewer also identified the source memo's 10px text and 7–9px metadata as too small for the moment when researchers need to compare evidence. The source and note titles are now 13px; excerpts and inputs are 12px. Long file paths move to hover text, node types use Korean labels, and excerpts have two lines. The popup retains its bounded width and scrolling list. Light-mode action contrast and dark-mode text contrast were increased.

## Verification

The pre-fix compiled app failed the new saved-answer marker assertion in an isolated fixture (`tmp/round40-before-fix.log`). The integrated UI regression exercises real capture buttons and a separate Notes renderer, first opening a note and then targeting a second answer while that note is already open. It checks visible expanded answer text and preservation of authored note content. The existing managed overview refresh may add its own sections on opening, so whole-file equality is not the right invariant for that operation.

The Product UI regression also dispatches mouse entry and leave after exact memo navigation and verifies that the source remains highlighted. Callback-level tests separately cover interruption and stale-paper hover. No model inference is used. Final integrated test and independent screen-review results are recorded below once completed.

## Remaining scope

The review identified another layout issue: the Notes relationship panel gives substantial space to its graph and empty citation explanation while connected-note results scroll in a smaller area. That information priority remains to be improved. The broader goal still requires multidisciplinary translation semantics, unusual mathematical layouts, further first-use evaluation and Mac physical-device verification.

The integrated build, core, Product UI and Notes UI suites passed after the final navigation and capture-format changes. Product UI verifies first-open and already-open destinations and checks that a cited answer retains rendered source links. The final CSS-only input-height adjustment is covered by the subsequent screen check rather than another full logic-suite run.

Independent CDP review confirmed the [new answer opens directly with formatted source links](images/round40-answer-final.png), both first-open and already-open note flows, and exact engineering p4 source highlighting after hovering a different sentence. The [dark memo](images/round40-memo-dark.png) and [light memo](images/round40-memo-light.png) were readable without overlapping controls. These memo captures precede the final standalone input-height fix. Only labeled synthetic history was saved in an isolated fixture; this is interaction evidence, not model reasoning quality.

The previous commit 7e891db CI run 34419042298 passed Windows, macOS Intel and macOS Apple Silicon. This supports that follow-up build, without proving the exact scheduling trace of the earlier Intel failure.

The final answer screenshot also shows a cross-paper reference using a local paper ID in its label. The link works, but resolving a readable paper title there remains a distinct presentation improvement. The existing playful note action labels and relationship-panel density still need a broader tone/layout pass.

A second independent reviewer followed the saved answer source to engineering p4, verified the exact table-caption target (p4-s20-v11v4y), and opened its matching memo. Hovering p4-s3 did not replace that source highlight. The [final engineering return screen](images/round40-engineering-return.png) uses the final CSS: both inputs measured 32px and source text 13px. The reviewer used a native Notes click plus CDP renderer events and measurement, without saving or invoking AI. Narrow side-by-side PDF text remains small when that layout is explicitly retained.
