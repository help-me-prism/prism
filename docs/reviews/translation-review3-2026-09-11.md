# Translation follow-up — September 11, 2026 (11:28–11:36 screenshots)

The reported files were reproduced using copied PDFs and a separate application profile. The original library was not modified by tests.

## Changes

- Use embedded font weights to separate a bold figure-caption title from its regular explanatory legend. CRISPR page 14 now keeps only the figure and bold title in the figure region; eight legend sentences are translatable prose.
- Translate institutional affiliations while retaining author names and publication furniture. Protect name initials from incorrect sentence splits.
- Bound original-image crop padding against neighbouring text. Keep fraction ink and algorithm rules without copying scraps of adjacent prose. Use the same bounds for selection anchors.
- Reassemble numbered algorithm rows even when the first fragment is already classified as a table. Preserve the complete Algorithm 1 (rows 1–14) and Sequential/Dense code block in SLE page 4.
- Keep raised radical glyphs within inline formulas and section headings. SLE section 2.1 no longer loses the square root or moves after its paragraph.
- Match optional LaTeX sentences conservatively in both directions; split sentences outside math, preserve PDF citation numbers, and refuse unrelated code. Unmatched prose retains PDF context instead of inheriting a loosely matched TeX paragraph.
- Exclude internal placeholder indices from scientific-number preservation instructions. Require Korean for institution-only affiliation sentences and explicitly request affiliation translation.

## Verification

- Real source fixtures: SLE pages 1, 3, 4, 9 and CRISPR pages 1, 14; regression assertions cover all reported structural failures.
- Actual app/provider translation completed with no warnings: SLE pages 1 (17), 3 (18), 4 (10); CRISPR pages 1 (23), 14 (9). Counts are translatable segments, excluding protected code, equations, names and furniture. The initial affiliation retry failures were fixed and rerun successfully.
- Side-by-side rendering audit: SLE pages 1, 3, 4 and CRISPR page 14 had zero significant block collisions, horizontal overflow, or missing translated prose. Exported original-pixel canvases visually confirmed the complete formula, all 14 algorithm rows and both horizontal rules.
- Figure extraction across 11 papers / 173 pages retained the same accepted diagram counts as the previous corpus audit; four false candidates remained rejected.
- Full core regression runner passed, including the new reported-PDF regression and placeholder preservation test. Build and standard macOS arm64 packaging run separately.

These tests cover the reported cases and the local regression corpus; arbitrary PDFs and nondeterministic provider output still require normal validation and visible retry handling.

## Delivered build

- Updated `release/mac-arm64/Prism.app` and `release/Prism-0.1.0-macOS-arm64.dmg` using the standard arm64 packaging command.
- Packaged main process, translation harness and renderer bundle match the built files byte-for-byte.
- DMG SHA-256: `a2ba1f799281f478042a0b2ca39aaeaac91284216d665ac96aaad4a299b42971`.
- All 82 core test scripts passed. Electron UI smoke passed. Packaged-app layout audits covered all five reported pages plus Attention page 13, Arti-PG page 4 and FSDR page 3 with zero significant overlap or horizontal overflow.
- Additional live translations in the packaged app: Arti-PG page 4 completed 27/27; FSDR page 3 completed 18/18, both without warnings. The isolated test app was closed and the updated normal Prism app reopened.
