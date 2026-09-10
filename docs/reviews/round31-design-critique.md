# Independent reader design critique

The user rejected the typography and source fidelity. A separate design critic inspected the actual Windows reader rather than scoring code or accepting a mockup. This is an AI review with observable checks, not evidence of human aesthetic approval.

The review uses the engineering paper's page 4. At equal page widths of about 481 px, equation and figure starts differed by about 2–3 px. Table, equations, figure, DOI and page furniture were present in corresponding order. This page does not support a claim that all source geometry is lost. It also does not establish quality across other pages or papers.

Outstanding findings:

1. With chat and side-by-side comparison open, each page shrinks to about 291 px and body glyphs to about 4–5 px. This is unsuitable for sustained reading. The existing larger-translation action and narrow-screen stacked comparison help, but deliberately selecting a narrow side-by-side layout still produces tiny text.
2. Original equations preserve subscripts as pixels; translated prose can still show flattened symbols such as `m0`. Correct protected inline-math handling needs separate validation; guessing subscript formatting from arbitrary text would be unsafe.
3. Translated paragraph emphasis and visual density remain weaker than the source in places. This is partly a subjective typography finding. Merely changing the font family would not restore sentence-level source emphasis.

Code inspection also identified a separate measurable defect: fallback PDF rectangles used a minimum interaction height as the font size. At small scales that inflates translated text. The correction separates actual transformed font size from the hit target size.

The Notes screen additionally mixed Georgia headings with the UI typeface and inherited CodeMirror's underlined heading syntax. Live notes now use the locally bundled Pretendard family for body and headings, with 14 px body and 24 px primary heading. Live heading syntax no longer adds an underline; actual Markdown links retain their existing styling. PDF source pixels and translated-paper type were not changed by this note style correction.

Validation after these changes: integrated build, Product UI, Notes UI and the PDF layout suite passed. The latter checks actual engineering-PDF text items at 15%, 40%, 50%, 100% and 200% viewport scales, including the old 25% font inflation at half scale. The complete core suite passed immediately before these geometry/Notes styling changes; affected layout and UI tests were rerun afterward.

The critic caught a remaining underline in the first native build: the editor's mode-reconfiguration path discarded the new highlighting style. Both initialization and reconfiguration now use it. A real computed-style assertion and the complete Notes UI suite passed after the correction. The test initially used an assertion API absent from this harness; correcting that test setup was not classified as a product fix.

Final native review confirmed the biology title changed from three serif lines to two sans-serif lines, heading text underlines disappeared, and actual wiki-link underlines remained. The parent reviewer also opened the [final Notes crop](images/round31-notes-font-final.png). This is a focused readability improvement, not overall aesthetic acceptance.

Design references: [Linear's UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) explains reducing navigation noise, alignment and hierarchy; [Readwise Reader](https://readwise.io/read) provides a reading-focused product reference. These are direction references, not claims of copied visual fidelity.

Actual-screen evidence: [equal-width comparison](images/round31-taste-wide.png), [narrow comparison](images/round31-taste-narrow.png), and [large translation](images/round31-taste-large.png). These captures precede the fallback font-metric correction; they do not demonstrate that fix. No paid AI inference was dispatched during this review.
