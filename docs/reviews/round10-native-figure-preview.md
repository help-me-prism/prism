# Final native figure preview and source return

Windows native review on compiled build, PID15580 / port9351, 2026-09-10. Existing engineering p4 Figure2 and the cached successful Haiku answer were used. **No AI call.**

Passed:

- Clicking the existing answer's p.4 figure citation centers the complete composite figure vertically in the original pane. The saved-figure rectangle matches its boundaries.
- Recapturing the existing figure produces a new attachment thumbnail. Clicking it opens the preview; the original-loading indicator finishes and reports1,830×661px.
- 100% original scale shows actual image pixels with horizontal and vertical scrollbars. Native two-axis scrolling pans across the figure.
- Fit view restores the full composite image, including both right-hand labels and photo pairs.
- Escape closes the preview and restores focus to the attachment thumbnail.
- Starting in Korean-only mode, clicking the cached figure citation reopens comparison mode, waits for the original page rendering, and centers the complete saved figure with the matching rectangle. This fixes the previous review's partly clipped figure return.

Durable screenshots:

- [Centered source figure](images/round10-figure-centered.png)
- [100% image after panning](images/round10-preview-original-pan.png)
- [Fit preview](images/round10-preview-fit.png)
- [Korean-only citation return](images/round10-korean-citation-centered.png)

No blocking problem observed in these flows. A minor polish issue remains: hovering this historical figure citation shows its stored source text containing a local asset path and normalized coordinates. The actual click navigation works correctly; this tooltip could show a short human-readable figure description instead.

Native ownership released after capture. This report covers Windows only; no claim of macOS native verification or fresh AI accuracy testing.
