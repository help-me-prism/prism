# Round 21: reader taste baseline

2026-09-10, HEAD `8a2b871`. Independent critique before the proposed flow-font changes. Read the user's attached older side-by-side screenshot, existing round17/18 captures, and the current native p11 reader in the isolated persona session. The visible review process was PID 14432 / port 9351. No source edits, new translation, or paid AI calls.

## Review criteria

- Compare the same page's figure, caption, paragraph, section heading and footer positions. Retaining content is not the same as retaining page layout.
- Inspect loaded fonts, actual rendered sizes, weights and line heights. A subjective dislike of a serif font is distinct from tiny captions or inconsistent heading families.
- Judge whether the first reading action and the difference between layout modes are apparent without exploring multiple controls.
- Count control rows and competing mode/zoom decisions. Prefer concrete evidence over adjective scores.
- State the scope of any acceptance and retain unresolved issues. A repaired crop or preserved equation does not approve the entire reader.

## Three priority problems

1. **The currently restored flow mode does not resemble the user's page-preserving reference.** The native p11 screen shows a long translated text column opposite a compact printed page. Paper mode recovers the figure, caption and footer structure, but the visible translated page bottom is around y650 versus original y607 under the same comparison condition. That is substantially closer, not identical. Recommend explicit mode names such as `지면 유지` and `텍스트 재배치`, and a comparison entry that makes the page-preserving option clear without silently overriding a user's saved preference.
2. **Typography has two incompatible reading scales.** Runtime `document.fonts` reports both Pretendard Variable and Noto Serif KR Variable loaded. This is not an inferred missing-font failure. Flow body computes to Noto Serif KR 450, 15px/29.25px; its heading uses Segoe UI 650, 18px/35.1px. Native paper-mode p11 body computes to 8.488px/12.563px and its caption to 6.791px/10.05px in the narrow comparison pane. Flow has large spacing and a visually heavier preserved-English sentence; paper-fit is too small for sustained screen reading. A restrained sans-serif flow body with approximately 1.75–1.8 line height is a reasonable design trial, not an established user preference. Preserve the source-oriented paper typography and make readable zoom/layout choices obvious.
3. **The reader still looks like several toolbars assembled together.** A document tab row, action row and pane-control row sit above two zoom controls and a format selector. The previous reference also had clutter, so copying all of its controls is not the goal. Preserve its paired-page reading structure while reducing mode/zoom decisions in the common path. The judgement that this feels inelegant is subjective; the separate rows and duplicated decisions are observable.

## Dark control contrast check

Read computed foreground/background values from the actual renderer; approximate sRGB contrast ratios are 5.64 for ordinary action labels, 5.25 for zoom labels, 12.70 for the format selector and 5.27 for the selected comparison label. Ancestor opacity for those controls is 1. Thus the enabled text should not be described as an objectively demonstrated severe contrast failure from this capture alone. Its small size, fine strokes and muted styling still make it visually recede. The completed-translation button is actually disabled with opacity 0.45; distinguish that from actionable controls when increasing visual emphasis.

## Accepted and unresolved

Verified: bundled font loading; source-oriented paper mode exists and retains page furniture/figures in this p11 example; before captures for both modes were saved after the mode settled. Unresolved: paper-fit legibility, exact page alignment, flow typographic coherence, and control hierarchy. No overall visual or product approval. No macOS comparison, exhaustive equation/caption audit, continuous-frame analysis, or new-user study was performed.

Local-only evidence: `tmp/ui/round21-taste-before-flow.png` and `tmp/ui/round21-taste-before-paper.png`. Do not commit full screenshots containing account information. Older screenshots in `docs/reviews/images` predate this baseline and are not proof of the current renderer.

## Final native after-review

Reviewed the second final renderer build after reload in the same visible persona process (PID 14432, port 9351). The process remains open for the parent. Used cached translations only; no AI requests. Tested engineering pages 11 and 4, both layout modes, and page 11 with the chat panel open to narrow the reading pane. Waited for the selected mode to settle before saving evidence.

Scoped improvements:

- `텍스트 재배치` now visibly uses a sans-serif Korean body with tighter leading and a more coherent relationship to the interface. This is a cleaner visual hierarchy in my judgement, not proof that the user's font preference is satisfied. `지면 유지` retains its source-oriented serif body; the labels now describe the actual distinction more concretely.
- Page 11 paper mode shows the figure, a two-line translated caption, paragraph indentation, section heading and footer without an observed collision. In narrow reflow, the protected English passage still wraps through its end, including `≥ 1.2`; no horizontal clipping was visible. The page indicator remained 11 when opening and closing chat.
- Page 4 paper mode keeps the top table, equations (1)/(2) between paragraphs, and the lower figure/caption in corresponding page regions. Its short translated figure caption remains one line after the source caption width was restored. No new caption overlap, equation-number clipping or paragraph collision was visible in this sample. This short caption does not exercise a long Korean caption. The translated page bottom is approximately 28 screen pixels lower than the original, so this is page-structure correspondence, not identical pagination.

Still unresolved:

- Narrow side-by-side paper-fit text and captions remain small. This review does not endorse that view for sustained reading; a larger pane or zoom remains necessary.
- The protected original English raster is visibly bolder and serif next to the new Korean sans body. Its preservation avoids inventing damaged mathematical text, but the typographic discontinuity remains obvious.
- Three control rows and separate zoom/layout decisions still make the reader feel busy. This iteration improves body typography and layout naming; it does not resolve the whole control hierarchy.
- Only these cached engineering pages and one narrow-pane arrangement were checked. No new-user study, macOS check, exhaustive mathematical-content review, or whole-product approval is implied.

Local-only fullscreens: `tmp/ui/round21-after-paper-p11.png`, `tmp/ui/round21-after-flow-p11.png`, `tmp/ui/round21-after-flow-narrow.png`, `tmp/ui/round21-after-flow-p4.png`, and `tmp/ui/round21-after-paper-p4.png`. They include account/sidebar context and must not be committed. Reader-only crops excluding that sidebar are saved as `docs/reviews/images/round21-paper-p4-reader.png`, `round21-paper-p11-reader.png`, and `round21-flow-p11-reader.png`; the p4 crop was reopened to verify its contents.

Parent-reported verification, separate from this independent native review: build, full core tests and product UI tests passed; Windows portable release was packaged under `release/reader-taste`, all 431 built files matched exactly, and actual packaged first-use/font smoke checks passed. This reviewer did not independently rerun those checks.

Design-principle references supplied and reviewed by the parent: [Linear's design refresh](https://linear.app/now/behind-the-latest-design-refresh) for prioritizing working content and reducing competing interface detail; [Readwise Reader appearance documentation](https://docs.readwise.io/reader/docs/faqs/appearance) for separating reading preferences. These are principles informing critique, not claims that Prism reproduces those products' design.
