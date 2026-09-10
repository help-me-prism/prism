# Scientific translation and PDF corpus review

Checked 2026-09-09. These are real open-access papers downloaded from their publishers into ignored `tmp/corpus/` fixtures, not papers bundled with the app. This review checks selected pages and specific failure modes; it is not a whole-corpus translation benchmark or user study.

| Discipline | Official source | PDF | Reviewed extraction pages |
|---|---|---|---|
| Evolutionary genomics | Kim et al., [Single-fly genome assemblies fill major phylogenomic gaps across the Drosophilidae Tree of Life](https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.3002697), PLOS Biology, 2024 | `biology-drosophilidae-genomes.pdf`, 23 pages, 2,181,709 bytes | 1, 3, 4, 8 |
| Civil/materials engineering | Li et al., [Experimental study on pore structure characteristics and thermal conductivity of fibers reinforced foamed concrete](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0287690), PLOS ONE, 2023 | `engineering-foamed-concrete.pdf`, 17 pages, 4,292,793 bytes | 1, 3, 4, 5, 9 |

Both PDF metadata and page counts were checked with Poppler. Biology page 3 and engineering page 4 were rendered and visually inspected. PDF.js 6.3.289 text items were passed through the actual reader parser. The original item coordinates for several engineering page 4 cases are retained in `scripts/fixtures/engineering-text-items.json`, with source attribution.

A subsequent extraction pass covered all 40 pages (23 biology + 17 engineering). After fixing inline figure-reference boundaries, the parser recognizes exactly the five numbered biology figures and fifteen engineering figures plus two engineering table captions. This checks caption identification, not visual completeness of every extracted figure. The full-page extraction JSON and summary are in ignored `tmp/corpus/`.

An attempted Scientific Reports download returned HTML instead of a PDF. It was excluded and renamed `nature-blocked-response.html`; a successful HTTP response alone is not valid PDF evidence.

## Observed defects and changes

- The case-insensitive section-boundary expression treated an inline measurement beginning with a digit as a new heading. Engineering page 4 split a three-dimensional specimen size into text, an untranslated artifact, and text. The parser now keeps all three dimensions in one sentence.
- The same rule split an inline density subscript from its sentence. The original subscript and following prose now stay together, although extracted inline typography remains plain text.
- PLOS uses `Fig 2.` as well as the common `Fig. 2.` spelling. The former was split into two text sentences and failed figure-caption association. All three forms (`Fig`, `Fig.`, `Figure`) now remain caption blocks. Engineering page 4 recognizes both its table and figure captions.
- Inline references such as `Fig 2)` must not start captions. Whole-corpus inspection found these false boundaries could consume several prose paragraphs as a caption. A caption delimiter is now required. Parenthesized method labels, citations, and supplementary file extensions no longer count as display equations merely because they contain brackets.
- Two otherwise readable body sentences contain an unmapped comparator glyph in the original PDF text layer (biology page 7 and engineering page 11). Segments containing the Unicode replacement character are kept as original image excerpts rather than translated with an invented comparison direction.
- Repeated PLOS page furniture and standalone DOI links were entering translation batches. Recognized publisher headers and standalone DOI lines are omitted from reading segments; the original PDF remains intact.
- The scientific output gate previously checked only equations and numeric citations. It now also checks preserved quantities, precision, units, comparison operators, and letter/digit identifiers, allowing unit whitespace and micro-symbol variants. Repeated equations/citations must retain their occurrence counts. Valid cached translation is reused; scientifically corrupted cached segments are retried. An unambiguous `{translations:[...]}` wrapper is recovered without another model call.

The prompt explicitly preserves uncertainty, negation, effect direction, and the distinction between association and causality. These semantic properties are not established by regular-expression validation. The historical five-segment real Luna translation output still passes the stricter gate; this review did not spend tokens translating either full paper.

`inspectTranslationBatch` separates independently valid translations from rejected or missing sentences, preserving useful work without another model call. Unknown or duplicated IDs reject the entire mapping to avoid attaching an answer to the wrong source. Automatic retry and model escalation are not part of this helper.

## Verification and remaining limits

`scripts/test-pdf-text-extraction.mjs` checks the real coordinate fixture, captions, page furniture, and section boundaries. `scripts/test-translation-science.mjs` rejects changed doses, durations, p-values, comparison directions, scientific identifiers, engineering signs/units, and dropped repeated math/citations; it also checks safe wrapper recovery and cached scientific corruption. Both pass, along with the product-core tests and TypeScript checks at the time of this review.

The engineering PDF contains broken embedded equation text mappings (`¼` and replacement characters) despite a correct visual PDF. The reader must continue using original equation crops rather than asking a model to reconstruct those glyphs. Complex tables and composite figures still need screen-level verification. Biology page 3's publication sidebar is appended after body text by the PDF content order; this selected-page review has not established a universal reading-order solution. Negation and causal language need ongoing real translation review across disciplines. No macOS hardware verification is claimed here.
