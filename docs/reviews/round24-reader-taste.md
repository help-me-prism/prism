# Round 24: independent reader taste critique

2026-09-10. Actual isolated persona reader PID 14432 / port 9351, engineering page 4 with the beginning of page 5 visible. Compared original and translation in side-by-side paper mode, then inspected each at the same full reading width. No code edits or AI calls. This is not a user taste approval: the complaint about awkward typography and insufficient resemblance remains valid in concrete respects.

## Three visible problems and priorities

1. **Printed structure is lost in preserved table content.** The page 5 original table shows gray row separators and a strong header; the translated side appears mainly as small text without those row separators. Check table/artifact classification and the precise-rectangle crop path in `ReadingTranslation.tsx`. Preserve the whole table rectangle including rules and background, rather than preserving only glyph rectangles. The precise causal path is a hypothesis requiring parser/canvas inspection, not an established diagnosis from the screenshot alone. This is the highest priority because it affects actual table reading.
2. **A numbered subsection loses its paragraph boundary.** At the same approximately 1013-pixel paper width, the original page 4 separates its formula explanation from `(4) Thermal conductivity tests.`; translation combines the formula explanation and `(4) 열전도율 시험.` into one paragraph. Preserve that source boundary and run-in heading emphasis when grouping blocks. Do not fix this by inserting arbitrary breaks in translated prose: use source geometry/block structure. This weakens the source resemblance even when text is enlarged.
3. **The apparent ink weight differs substantially.** The enlarged Korean serif body remains much lighter than the original body and bold caption. At 481-pixel comparison width it also becomes very small and visually fragile. Current code uses Noto Serif KR 450 in `product.css`, with individual 700 weights conditional on `sourceFontWeight` in `ReadingTranslation.tsx`. Check the actual source-weight metadata before changing weight globally; preserve heading/body distinction. A modest optical-weight comparison at equal paper width is more useful than another wholesale font substitution. The judgement that the serif looks awkward is subjective; lost boundaries and different visible emphasis are observable.

## Page-height correction recheck

Before the parent's correction, page 4 ended near y642 on the left and y676 on the right. After reloading the build that removed the fixed extra 28 pixels and changed canvas display, the ends were approximately y642 and y648; the next pages began around y660 and y666. This is a clear improvement from about 34 to 6 screen pixels. It does not prove exact pagination on all pages. `PaperTranslationLayout.tsx` previously included page furniture when computing `lastBottom + 28`, which the parent corrected. This resolved item should not displace the remaining priorities above.

## Evidence and limits

Reader-only crops excluding account/sidebar context:

- Before height correction: `tmp/ui/round24-reader-only.png`
- After height correction: `tmp/ui/round24-reader-only-after.png`

Full local screenshots: `tmp/ui/round24-reader-taste-current.png`, `tmp/ui/round24-translation-large.png`, `tmp/ui/round24-original-large.png`, `tmp/ui/round24-footer-after.png`. Do not commit fullscreens with account context. The before crop was reopened for visual inspection; after crop derives from the observed post-reload screen.

This review does not approve the entire visual design, translation quality, scientific correctness, or the user's preferred font. No new biology sample or macOS screen was inspected. Existing larger-reading controls help readability but do not repair paragraph/table fidelity. The reviewer returned the persona to left/right comparison, page 4, chat closed.

The parent independently consulted [Linear's design refresh](https://linear.app/now/behind-the-latest-design-refresh) for predictable header placement and reducing visual noise, and [Readwise Reader appearance documentation](https://docs.readwise.io/reader/docs/faqs/appearance) for reading-interface preferences. These are design principles, not evidence that copying either service resolves Prism's source-format problems.

## Temporary weight A/B

The parent reported an independent metadata check identifying the source body as MinionPro-Regular. Earlier references to its bold appearance describe visual ink density, not proof of a bold font face. Tested temporary paper-only weights 500 and 550 at the same approximately 1013-pixel width as 450. No file was changed; removed the temporary style and confirmed computed paper weight returned to 450.

My preference is 500 as a modest optical adjustment: strokes look steadier without making the paragraph uniformly heavy. At 550, complex Korean strokes and surrounding numbers feel denser, with no clear additional reading benefit in this example. This is a subjective, one-page judgement, not a measured reading-speed result or user preference. Neither weight repairs missing table rules or merged subsection boundaries. Screenshots: `tmp/ui/round24-weight500.png`, `tmp/ui/round24-weight550.png`; the earlier `round24-translation-large.png` shows 450.

## Final integrated native recheck

Reloaded the final build containing paper weight 500, whole-table preservation and numbered subsection boundaries. In the same engineering page 4/5 view, the page 5 translated table now visibly retains its row and column rules, and page 4 separates the formula explanation from `(4) 열전도율 시험.`. The earlier `(3)` subsection also starts separately. The page 4 bottom edges are now approximately aligned (about one screen pixel apart in this final capture). No new visible overlap appeared in this limited sample. These are specific corrected defects, not whole-reader or taste approval; small comparison text and remaining source/translated visual differences persist.

Final privacy-safe reader crop: `tmp/ui/round24-final-reader.png`. Full source screenshot: `tmp/ui/round24-final-full.png` (local only, account/sidebar context). Persona PID 14432 / port 9351 is left open in page 4 left/right comparison, chat closed. No source files were edited and no AI call was made by this reviewer.
