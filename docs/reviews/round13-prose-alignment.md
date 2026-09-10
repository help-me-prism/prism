# Native protected-prose alignment check

Windows existing persona PID 23948 / port 9351, 2026-09-10. Reloaded Reader with Ctrl+R, entered engineering page 11, closed chat for a wider stacked original/Korean comparison, and scrolled to the preserved comparator sentence. Used only cached content; **zero AI calls**.

The Korean pane correctly displays **원문 보존 1곳**. The complete preserved English sentence, including `S ≥ 1.2`, remains readable, with no clipped comparator or overlap with surrounding Korean. The Korean prose above and below remains readable.

However, the intended first-line left alignment is **not visibly applied** in this run. “Compared with the FC without” starts at approximately x951, while the next line starts around x572. This matches the awkward inherited source offset visible in the prior `translated-comparator-preserved.png`. The issue was reported before further changes; no source files were edited by this reviewer.

A separate observed navigation issue: closing chat widened the panes and changed the visible page counter from 11 to 10, so page 11 was entered again before the captured comparison. This was not investigated further in this bounded check.

Evidence: [initial native comparison](../../tmp/ui/round13-prose-alignment-initial.png), [prior comparison](images/translated-comparator-preserved.png).

## Actual glyph geometry and navigation repair: final native pass

The real protected sentence has smaller italic-variable and comparator ink boxes within normal text lines. The initial same-height grouping rejected these correctly preserved glyphs. The implementation now assigns a smaller box only to one unambiguous containing text-line band, retaining its exact vertical position and shared horizontal shift. Tiny glyph overhangs are allowed; duplicated slices, ambiguous superscripts and overlapping line bands still retain the original layout. Actual page-11 glyph rectangles are saved in `scripts/fixtures/engineering-precise-excerpt.json`; the regression checks exact source rectangles, dimensions, source order and within-line spacing.

The separate reviewer reproduced the chat-close page-11-to-10 jump twice before the fix. A scroll event can arrive before ResizeObserver during width reflow, so the reader now retains its previous anchor instead of storing an interim page position. After rebuilding and Ctrl+R, two chat-open/close cycles retained both **11 / 17** and actual page-11 prose. The first cycle still moved the passage vertically by approximately 30px; the second was stable. This proves the tested page-retention repair, not pixel-identical passage placement across every resize.

The protected English sentence now begins at the left edge, and all three original lines including `S ≥ 1.2` remain intact. The surrounding Korean remains readable and the pane reports **원문 보존 1곳**. Zero AI calls were made. The final [Reader-region capture](images/round13-prose-aligned-final.png) shows the resulting layout; native full-window captures and the two fixed navigation cycles remain in local `tmp/ui/round13-*.png` review evidence.

Validation: production build, original and precise-glyph excerpt regressions, and full product UI passed. The product UI now toggles chat twice from a later translated page and checks actual page geometry as well as the page-number field. This scoped pass does not establish identical page heights or complete scientific-layout coverage.
