# Reader typography and source fidelity review

The independent design critic reviewed the actual Windows reader, including a
side-by-side comparison of page 11 of the engineering fixture. This is a scoped
visual review, not a claim that an AI can determine the user's taste objectively.

Verdict before this change: reject source fidelity and body typography. The UI
already uses bundled Pretendard; that does not resolve the translated document's
composition. At the observed window size, the translated page ended approximately
142 pixels below its original counterpart. In flow mode, preserved English prose
looked roughly half the size of the Korean prose. Sidebar and toolbar space further
reduced the available reading width. Evidence is retained locally in
`tmp/ui/round16-reader-source-comparison.png` and
`tmp/ui/round16-reader-flow-comparison.png` (not published; includes test profile UI).

The first correction lets translated paragraphs consume existing vertical
whitespace before moving the following block. Original top coordinates remain the
preferred positions. Only actual collisions move subsequent content, retaining a
small clearance bounded by the original gap. Columns remain independent until a
spanning element joins them. No text is truncated or shrunk and PDF crops are not
modified. Regression checks cover small expansion at two scales, column
independence and non-overlap. Production build and product UI suite pass.

The independent native follow-up used the same page, window and 100% translation
setting after reload. The original page ended at y607; the translated page end
moved from y749 to y674, reducing the observed discrepancy from approximately 142
to 67 pixels. No new clipping or overlap was observed in the visible figure,
caption, protected inequality sentence or footer. The heading still breaks into
"공극" and "률." on separate lines. Evidence: `tmp/ui/round16-reader-gap-fixed.png`.
This is a limited approval of whitespace handling only.

This does not solve the remaining typography and layout issues: text-only zoom in
paper mode, fixed Korean leading, lost paragraph indentation/alignment, mismatched
preserved English prose, and missing non-text page decoration. Full visual approval
requires inspecting those cases, not merely passing the automated layout checks.

Further design reviews should identify a specific screen, visible defect and
reading consequence, then compare the same screen after the change. Avoid numeric
beauty scores and generic praise. The user's reference prioritizes recognizable
paper structure, restrained controls and readable type over decorative styling.
