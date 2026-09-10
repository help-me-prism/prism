# Paper structure extraction audit

Date: 2026-09-10  
Branch: `feat/formula-table-figure-extraction`

## Method

1. Inspect LaTeX structure first and flag inline `$…$`, matrix/cases/aligned environments, tables, and figures.
2. Run the production PDF text extractor over every page without a model call or screenshot.
3. Compare saved anchors with LaTeX block identity and page geometry.
4. Inspect pixels only for geometry that remains ambiguous after the first three checks.

The repeatable command is:

```text
node scripts/audit-paper-structure.mjs <paper-directory>
```

## 2210.02747

Static source scan found 74 display-equation blocks, 4 tables, 17 figures, 41 complex equation blocks, and 96 prose/theorem/caption blocks containing inline math. These are the high-risk locations; they are not treated as failures by themselves.

Verified regressions and outcomes:

- Rotated arXiv publication furniture is excluded from translation.
- Math-rich prose beginning with `where`, `Given`, or `Let` remains prose instead of becoming a detached equation.
- Page 4 equation 13 is separated from its preceding prose, while the tall fraction/norm content of equation 14 remains one equation.
- Page 15 equations 28 and 29 each remain one matrix equation; the prose lead-in between them remains text.
- Global monotone LaTeX/PDF alignment maps equations 28 and 29 to `latex-57` and `latex-58` even when an earlier PDF equation is damaged or absent.
- Table 1 selects all six geometry segments around its caption. Table 3 selects all three.
- Table 4 selects page 21 segments 0–4 and stops before the plot artifacts and Figure 10 caption at segments 5–12.
- Hover previews use viewport-fixed coordinates, flip below near the top edge, stay inside both horizontal edges, and are recalculated after a lazy image finishes loading.

Remaining audit warnings are deliberately conservative. Eight complex LaTeX equations have no strong saved LaTeX match, so they retain PDF evidence instead of being assigned the wrong source. Repeated equation number 15 appears on pages 5 and 14; it is reported for review but not automatically merged because page-separated repetition can be intentional.

## Cross-paper checks

| Paper | Domain/layout | Pages | Detected equation segments | Table captions | Figure captions | Suspicious prose-as-equation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 2006.11239 | machine learning, dense equations/tables | 25 | 40 | 4 saved tables | source figures present | 0 after prose-clause fix |
| 1706.03762 | machine learning, PDF-only fallback | 15 | 11 | 0 saved tables | source unavailable | 0 |
| PLOS ONE 0287690 | civil/materials engineering | 17 | 1 | 2 | 15 | 0 |
| PLOS Biology 3001161 | biology, image-heavy figures | 25 | 0 | 1 | 13 | 0 |

The engineering and biology PDFs were added only to the local test-paper folder. Their full-page extraction was code-only; no translation-model call was made. Existing PLOS geometry fixtures cover ruled tables, captions, multi-panel figures, subscripts, dimensions, and publication furniture.

## General safeguards added

- Display math boundaries combine baseline movement, centered geometry, font metadata, equation numbers, and prose transitions instead of relying on character count alone.
- Table membership chooses the stronger geometrically coherent side of a caption and stops on headings, other captions, prose sentences, misalignment, or large gaps.
- LaTeX equations are aligned globally in order with skips on both sides, preventing one bad match from shifting the rest of a paper.
- Hover previews are independent of chat/composer clipping ancestors and constrained to the viewport.
- Translation remains a downstream consumer: structural boundaries and numeric/math preservation are decided before the translation model. A weaker model can produce worse Korean, but it cannot repair incorrect extraction, and it no longer controls these boundaries.
