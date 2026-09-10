# Keeping the reading size when opening a question

The previous round made verified progress on source memo entry and keyboard safety. This round addresses the critic's recurring observation that opening chat shrinks fitted PDF text. The full reader, multidisciplinary translation, ontology productivity, and release goal remains active.

## Behavior

Selecting a source sentence from a fitted original or paper-format translation records that page's actual rendered scale before chat opens. The contextual **읽던 크기로** action opens the chosen document alone at that exact scale and brings the selected source into view. It does not round the rendering to a standard zoom level. A custom value is shown in the zoom selector when needed.

The prior layout, zoom and fitting flags stay available through **비교로 복귀**, or **이전 보기** for a prior single-document layout. The temporary layout is not written as the saved comparison preference. Manual scrolling and explicit zoom/fitting take control away from automatic centering. If the old page is wider than the available space, it remains horizontally scrollable rather than reducing its text size again.

This action is offered after a fitted document selection opens previously hidden chat. It is not a claim that every way of opening chat automatically preserves size: manual chat opening, figures and flow-format text are outside this trigger. Preserving a small pre-chat scale also does not make that scale sufficient for sustained reading.

Korean composer text uses word-boundary wrapping to avoid breaking a short word immediately after a long inline source chip. Long unbroken content retains the existing overflow wrapping. This is a small typography adjustment, not a complete redesign of dense questions.

## Verification

The integrated build, complete core suite and Product UI passed. For both original and translated paper views, Product UI records the actual canvas width before opening chat and verifies restoration within 1 px, along with the exact non-100% scale, the custom zoom value, selected-anchor visibility during horizontal overflow, restoration of the comparison layout and both zoom selectors, and unchanged saved layout. It then runs the existing source memo, keyboard, draft, and storage regressions.

The first new test incorrectly treated the hidden chat's mounted editor as absent; the corrected test observes the actual chat visibility state. No product change was made for that setup error. The final run additionally checks painted canvas width, not only a scale attribute.

Independent Windows review observed engineering page 5 shrink from roughly 481 px [before chat](images/round35-before.png) to 291 px when chat opened, then [return to 481 px at 79%](images/round35-restored-original.png) in the temporary view. The selected sentence was visible and comparison return restored left/right fitting on page 5.

In biology page 2's stacked comparison, the [1013 px pre-chat paper](images/round35-biology-before.png) shrank to about 633 px, then [returned to its prior size at 166%](images/round35-biology-restored.png). The selected sentence was visible. Manual horizontal scrolling reached both paper edges and stayed where the reviewer left it. Returning to comparison kept page 2, stacked layout and both fitting controls. The parent reviewer opened the restored captures. These native checks cover original PDFs in two arrangements; translated-size restoration has automated painted-width coverage, and single-view return was not independently exercised natively. The biology Korean pane was displaying untranslated source, not a translation-quality sample. No live model inference was used.

The Windows review package matches 434 final compiled files and passes its first-use launch check. It is an unsigned review build, not a claim of release readiness.

## Next knowledge workflow

A separate read-only audit found that a source card's **주장에 연결** picker only targets existing claims. First-time claim creation is offered in a different link picker, so a researcher must leave the source, create a claim elsewhere, and return to connect it. Supporting explicit claim creation from that source is the next concrete ontology-productivity target; this round does not claim to implement it.
