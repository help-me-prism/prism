# Native ontology AI review

Windows, 2026-09-10. Existing isolated persona `tmp/prism-product-ui-persona-xJpKBJ`, PID 18376 / port 9351. No recovery-fixture or user files changed.

## Actual execution

Opened Notes, explicitly selected **Codex / GPT-5.6-Luna** in the status bar, then opened the engineering paper menu and clicked **AI로 이 논문 연결 제안** once. The running notice identified `gpt-5.6-luna`. No further AI requests, translations, chats, or retries were made.

The run completed at `2026-09-09T16:03:44.115Z`. Its persisted suggestion record contains provider `codex`, model `gpt-5.6-luna`, **0 relations created, 0 relations skipped, and empty candidates, concepts, and claims arrays**. The curation queue shows a recent AI run with zero recommendations. Its one existing biology question predates this run and is not a generated result. Nothing was approved.

Evidence: [explicit inexpensive model selection](images/round12-luna-selected.png), [completed run and unchanged queue](images/round12-empty-suggestions.png).

## Quality verdict and concrete limitation

The request/response/persistence/UI path passed, and the model did not invent a new relationship. This is an **empty-result test**, not evidence that useful supports/contradicts links were generated correctly.

Read-only inspection explains the limited opportunity for useful grounded output:

- The engineering note has an existing related link to the pore-shape concept and saved AI-answer cards. It does **not** have a `prism-evidence` quotation card in its current body. The suggestion renderer excludes saved AI answers, appropriately preventing generated answers from serving as primary evidence.
- The current vault has no Claim node to target with supports/contradicts.
- Calling the same `readPaperBody(...).outline(3, 60)` used by the production prompt returned only three lines: author affiliations, the general topic of comparing fiber-reinforced foamed concrete, and the preparation method listing 0%, 1%, 1.5%, and 2% fiber mass fractions. All cached text belongs to the generic `본문` section, so the three-lines-per-section cap omitted the later pore-shape/results discussion, including page 11.

For this supplied context, withholding assertive relationships is reasonable. However, treating all unsectioned PDF prose as one section makes scientific candidate discovery unnecessarily weak: the input effectively becomes the first three qualifying lines, including affiliation furniture. A later bounded improvement should sample substantive material across pages or use available headings rather than expand the model tier or automatically retry. The actual supports/contradicts path still needs a fixture containing a verified quotation card and a matching Claim node before its positive scientific quality can be assessed.

Native UI released after the result screenshot. One inexpensive AI call total.
