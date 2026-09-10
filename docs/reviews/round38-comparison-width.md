# A readable comparison in a narrow workspace

The preceding review established that 481px fitted pages, and 291px pages beside chat, are uncomfortable for sustained reading. The previous default compared side by side whenever the reading area exceeded 960px. A typical 1280px laptop window cleared that threshold despite leaving each PDF much less than its normal page width.

The first comparison now chooses stacked pages below 1280px of actual reading workspace, approximately two 612px PDF pages plus pane padding. It chooses side by side above that threshold unless the researcher has chosen a direction. Translation-only automatic opening uses the same width boundary. Existing saved layouts are not automatically rewritten.

When a saved side-by-side comparison is narrow, its existing main comparison button offers **상하로 넓게**. There is no additional toolbar row or button. Only accepting the action changes and saves the arrangement. The dropdown still shows the actual direction, and explicitly selecting narrow side-by-side dismisses the suggestion for that paper in the current session. A ResizeObserver measures the workspace when chat, the library rail or the window changes. Temporary large-reading return remains higher priority than the suggestion.

## Verification

The integrated build, core suite and Product UI passed. The UI test checks the laptop default, explicit side-by-side preference, saved-layout preservation before accepting a suggestion, retained page and zoom choices after acceptance, and a wide viewport whose reading space is narrowed by chat. It verifies that the question draft survives the direction change. Prior PDF raster, translation, reading-size restoration, source memo, keyboard and storage regressions also run. The wide-viewport automatic check uses CDP device metrics and is not a native monitor-size test.

Independent CDP interaction in the copied engineering vault verified that the [saved side-by-side arrangement](images/round38-before.png) remained unchanged until acceptance. With chat open, accepting the action expanded each fitted page from 291px to 633px in the [stacked view](images/round38-stacked.png), retaining paper, page 5 and the unsent question. Explicitly selecting side-by-side again removed the suggestion for that paper session. The parent reviewer opened both captures. Synthetic fixture chat history is labeled; no new inference or question submission was used.

The [biology p2 comparison](images/round38-biology.png) retained its stored stacked layout with 1013px-wide pages. Its main text and supporting column were readable at that width, with scrolling required in the shorter panes. It displayed untranslated originals and is not a Korean translation-quality evaluation. Suppression after a new app session is intentionally not promised; explicit saved geometry persists while the contextual suggestion may return.

This is progress toward comfortable comparison, not proof that all document formats or researcher preferences are satisfied. Dense tables, unusually wide pages, semantic translation quality and the broader knowledge workflow still require continuing review. No inference is needed for this behavior.

A separate code audit found that chat-answer capture does not carry the source vault ownership check already used by evidence memos. A concurrent vault change could route a save to a different vault containing the same paper ID. This is the next concrete knowledge-integrity issue to reproduce and fix; it is not addressed by the comparison change.
