# Matching source rendering and preserving untranslated paragraphs

The prior review found visibly heavier original text than the PDF crops in the translation pane, including table and header text. `PaperWorkspace` used screen-density rendering for originals but supersampling for translated-page source canvases. Both panes now use the same bounded supersampling policy. This changes PDF raster quality, not the source font or translated prose font. Equal zoom produces identical source-canvas dimensions and pixel data in Product UI.

Engineering page 5 exposed a second problem: its prose was untranslated, but protected table/artifact entries carried identity translations. Those entries incorrectly triggered reconstructed page layout. A heading and the beginning of its following sentence shared a line in the PDF but became separate blocks; collision avoidance moved “One specimen” onto a new line with a large gap.

Only displayable text, headings and captions now trigger prose translation layout. A page with only protected-content cache entries retains the complete original page and its sentence targets. In a partially translated page, an entirely untranslated heading/body paragraph stays one crop. Each sentence in the merged paragraph retains its own target using original rectangles, including keyboard and context-menu access. Existing unsafe scientific paragraphs remain preserved.

The translation pane tab now says **번역**, and an untranslated page explicitly says **미번역 · 원문 표시**. No translation is automatically requested by this change.

## Checks

The final build and core suite passed. Product UI verifies identical original/translation source pixels at equal 70% zoom, protected identity-cache-only full-page preservation, a real caption translation remaining visible with untranslated body text, and existing reading-size, draft, note-source and storage regressions. Initial new-test failures were setup mistakes: selecting an unavailable 50% zoom and querying the first caption instead of the translated caption's anchor. They were corrected to supported zoom and exact source identity.

Independent app-only CDP review used the isolated copied vault, not the user's vault. Engineering p5 returned “One specimen” to the correct line and retained distinct source tags. The p4 comparison no longer showed the original's previous overall heavy raster appearance. Biology p2 at 1013px showed matching original render quality; that page had no Korean translation, so it is not semantic translation evidence.

A temporary, explicitly synthetic caption translation exercised partial-page preservation. Clicking two sentences in the merged paragraph produced different anchors and the correct “One specimen…” and “The surface was sanded…” excerpts. The translation cache was restored with matching SHA-256 before the final reload. No model inference or question submission was used. Windows update UI obstructed native pointer review, so these interactions are accurately described as CDP and actual renderer capture review.

## Remaining usability

At 481px per paper, body text and table values remain small for sustained reading. The larger-view controls exist, but discovering a comfortable comparison arrangement remains a first-use problem. These changes do not prove broad translation meaning accuracy or overall visual approval. The full multidisciplinary reader and release objective remains active.

Captured evidence: [engineering p4](images/round37-p4.png), [p5 without the split sentence gap](images/round37-p5.png), [separate tags in a partially translated page](images/round37-partial-tags.png), [biology original comparison](images/round37-biology.png), and [final untranslated labels](images/round37-p5-final.png). The partial-page and final-label captures have chat open and therefore narrower fitted papers; the synthetic chat history is explicitly marked and is not live AI evidence.
