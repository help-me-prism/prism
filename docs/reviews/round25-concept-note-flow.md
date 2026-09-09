# Round 25: beginner biology concept-note flow

2026-09-10. Native Notes window 49417498 in isolated provenance app PID 16732 / port 9353. Reloaded current renderer. No AI questions or AI organization actions. Existing fixture notes were not edited. Created only `회귀검토25 초파리 유전체 조립`, a clearly named regression concept note, and linked it to the existing biology paper.

## Actual flow

Opened biology from the Notes home, used the plus next to the concept category, entered the regression title and created the note. Opened the note toolbar's `링크` picker and chose biology. The graph updated with two connected nodes. Returned to the biology tab: the right-side `이 노트를 연결한 노트` list included the new concept. Clicking that list item successfully reopened the concept. Thus creation, connection and finding the concept again do work in this sample.

## Main UX problems

1. **The easiest link action produces an implementation-looking document.** Without placing a cursor in the newly created note, toolbar `링크` inserted the long `[[papers/local-.../local-...|biology-drosophilidae-genomes]]` string before the document's title. The string remained visibly expanded into two lines after save and after reopening through the backlink. Recommend default insertion after the heading when no meaningful body selection exists, and display the alias as a normal readable link outside active syntax editing. The graph did recognize the link; this is not a claim of broken indexing.
2. **Creating a concept while reading a paper drops the immediate context.** The create form offered name/type/template, but no simple explicit option to link the new concept to the paper just opened. The user then had to choose between toolbar `링크`, `관계`, and `근거`. The link picker explains their distinction, but only after choosing one. A small explicit `현재 논문과 연결` option during creation, default behavior clearly shown, would reduce the need to learn three mechanisms. Avoid silently adding a semantic claim or relation type.
3. **The useful route back is visually secondary.** The right rail gives a large region to a two-dot graph with truncated labels, while the actionable backlink is a small text row below it. A beginner trying to resume a thought benefits more from a legible connected-note title and excerpt than from node position. Promote the linked-note list before or alongside the graph; keep the graph available. This is a hierarchy judgement, not a blocking failure: the backlink click succeeded.

The default editor's underlined serif title and duplicated top-level note title also made the screen feel less coherent to this reviewer, but font changes are not the priority of this bounded flow review.

## Evidence and limits

Local screenshots: `tmp/ui/round25-concept-link.png`, `tmp/ui/round25-paper-backlink.png`. No prose content was entered into the concept beyond the link; no semantic relation, approval queue, search model, external Obsidian editing or long-term persistence stress test was performed. No claim that these observations represent a real user study. The isolated concept remains for follow-up testing. Notes is left on that concept; UI ownership returned.

## Follow-up: first-link fix, actual native check

Reloaded the updated renderer and created `회귀검토25 첫 링크 수정 확인` from Notes home. With no body cursor placement, selected biology through toolbar `링크`. The heading stayed first, the next paragraph displayed only the readable alias `biology-drosophilidae-genomes`, and the caret moved to the following blank paragraph. Waited for `저장됨`, switched to biology, then reopened the concept via its backlink. Heading and alias remained correct. This specific insertion/rendering regression passed; the earlier malformed regression note was not retroactively repaired by this test.

Local evidence: `tmp/ui/round25-first-link-fixed.png`, `tmp/ui/round25-first-link-reopened.png`.

## Follow-up: contextual creation and connected-note list

Reloaded the final renderer. Opened biology, clicked the concept category plus and saw the checked `이 논문과 연결: biology-drosophilidae-genomes` option, with an explanation that creation adds a related relationship. Created `회귀검토25 논문에서 만든 개념`. Its right rail immediately showed biology at the top under `연결된 노트`, with `→ 관련`. Clicking the full title returned to the correct biology note; after loading, its body appeared normally and its top list included the new concept. The actual path from paper to concept and back passed without AI calls.

The promoted title list is easier to locate than a truncated graph node. Two non-blocking presentation issues remain: generated body text still exposes English `related`, and the same connection can appear in the top list, graph and lower backlinks, adding repetition. This does not constitute overall design approval.

Local evidence: `tmp/ui/round25-context-create.png`, `tmp/ui/round25-context-created.png`, `tmp/ui/round25-context-return.png`. Full screenshots remain temporary and must not be committed. Checkbox-off behavior, error recovery and other note types were not exercised in this native pass. Only the two additional clearly named regression concepts were created; no paid model or organization action was invoked. UI is released on the biology note, PID 16732 / port 9353.

## Implementation and independent regression findings

The subsequent build localizes the generated `related` wording as `관련`. A backend audit reproduced loss of an existing automatic link when a typed upgrade failed revision validation. The old link is now retired only after a successful typed-record write; stale revisions and injected disk-write failures preserve it. These cases passed real temporary-vault regression tests.

The Notes smoke also checks first-link placement and alias rendering, search misses versus missing evidence, and contextual creation with the checkbox enabled and disabled. A document that is still loading no longer advertises `저장됨`. The external-change probe found the appended text in the editor's full document even when absent from the rendered DOM; the regression now navigates to the document end before inspecting the external append. The existing conflict and history tests retain their checks. These are automated checks, distinct from the native observations above.
