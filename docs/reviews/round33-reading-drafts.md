# Reading across papers without mixing memo drafts

The previous turn made verified progress: source changes, real Windows review, and a checked executable. This round continued with an independent screen-based biology-reader scenario. It does not establish completion of the full product goal or human aesthetic approval.

## Findings and changes

Opening engineering sentence 88's memo and then switching to biology left the engineering memo floating over the biology PDF. Its small subtitle was the only indication that it still belonged to another paper. This could lead to a correctly executed save with the wrong intended source.

The capture panel now closes when the active paper or vault changes. Drafts belong to the vault, paper, and exact anchor, including when two PDFs have identical sentence IDs. Closing and reopening a source restores its memo and concept. These are session drafts; they do not survive an app restart.

Backlink responses cannot reopen a closed panel or replace another source. Saves are guarded against duplicate submission. A completed save clears only the version submitted; text written while saving remains in the draft. Save results and errors remain attached to their original draft. The backend checks the requesting vault and reads the library index from the captured vault, avoiding a second lookup of whichever vault is current later.

A further independent code review found a partial-success defect: the paper memo was committed before creating its concept definition and relation. Failure in that later work rejected the whole request, inviting a retry that duplicated the memo. Once the paper is committed, subsequent connection failures now return a saved result with a warning. The form clears the submitted version and explains that only the connection needs retrying with an empty memo. A real filesystem obstruction test checks the persisted memo and a successful connection-only retry. This is not a claim of transactional writes across all note files.

The toolbar action is explicitly labeled **페이지 메모** because its source is the current page, not the last sentence added to a question.

The typography audit found that resolved regular PDF weight 400 was discarded, leaving paper text to inherit weight 500. Both paper and flow rendering now apply resolved 400 as well as 700. Unresolved fonts retain their fallback. This preserves the source's normal/bold contrast without guessing cross-language inline emphasis. The inspected engineering and biology PDFs did not establish a whole-paragraph italic use case; isolated variables or species names are not grounds to italicize a translated paragraph.

## Verification

The final integrated build, full core suite, Product UI and Notes UI passed. Product UI uses two real generated PDFs with a colliding sentence ID. It checks separate drafts, close/reopen restoration, a delayed backlink response, duplicate submits, typing during an in-flight save, navigation before that save finishes, actual saved Markdown, and a rejected foreign-vault request. Actual computed styles verify regular source weight in both translation formats. An initial new test failed because its selector string was incorrectly escaped; correcting the test enabled the race scenarios to execute.

After the partial-success correction, the build and all three suites passed again. Product UI also obstructs the concept directory, verifies that the warning acknowledges the saved memo and clears its submitted draft, restores the directory, and retries only the concept connection. The persisted memo remains exactly once. The native captures below predate this final partial-success message change; that branch is covered by the actual Electron UI test and filesystem test.

Independent Windows review reproduced the [foreign memo over biology](images/round33-stale-memo.png). After the fix, switching to biology [closed the engineering panel](images/round33-draft-switch.png). Entering a separate biology draft and returning to engineering sentence 88 [restored both its memo and concept](images/round33-draft-restored.png). Closing with X and reopening also restored both fields. The parent reviewer opened these captures. This native check did not save notes or call AI; actual persistence and delayed-save races were checked by Product UI. No live model inference was used in this round.

At the smallest comparison width (about 291 px per paper), normal-weight Korean appears thinner and still requires enlargement for sustained reading. Correct source weight alone does not prove a satisfying font choice or solve the comparison-size problem.

## Remaining user-flow work

The critic also found that opening chat narrows a fitted comparison page substantially, reducing reading size. The larger-reading controls help but do not establish a seamless reading-to-question transition. Sentence memo creation still depends on the context menu; changing the page action label alone does not make that path discoverable. These remain concrete next targets, alongside the existing translation fidelity, multidisciplinary semantic quality, ontology productivity, and macOS/release requirements.
