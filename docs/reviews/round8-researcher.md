# Round 8 — evidence to durable knowledge

2026-09-09. Actual native Windows PID 23372. Graduate-researcher persona reading engineering page 11. Exactly one concise GPT-5.6 Luna question; no external messages. Existing test vault preserved.

## Actual completed flow

1. Started a fresh chat, clicked the Korean pore-shape ratio definition, and asked for one sentence using only the attached evidence. Composer showed a source chip; the submitted message displayed `근거1 p.11`.
2. Luna returned the correct ratio definition with a clickable page-11 citation. Clicked **노트에 저장** and saw the engineering-note confirmation.
3. Opened Notes from the reader; the correct engineering paper note opened. Scrolled to `Notes` and expanded the AI block. The answer, question, date, provider and model were present in the actual Markdown file.
4. Created **기공 형상 계수** using the concept-folder plus action. Used **근거**, searched `pore shape factor`, and selected the page-11 definition. The actual concept file stores quoted source text, paper/anchor/page metadata, content hash, stable block ID and a `prism://paper` source link.
5. Clicked the rendered evidence card: the reader opened engineering page 11 at the associated paragraph. [Source return](../../tmp/ui/round8/concept-return-source.png).

Actual files inspected: `tmp/prism-product-ui-persona-xJpKBJ/vault/papers/local-6f1c8cd4d2e4ef2b696770a8/local-6f1c8cd4d2e4ef2b696770a8.md` and `Concepts/기공 형상 계수.md` under that vault. No pre-existing personal note was replaced.

## Findings and changes

- **Saved answer discovery:** capture wrote `## Notes`, while **메모 보기** only recognized `## 메모`. Fixed the header to detect either existing heading and jump to the matched heading without rewriting user content.
- **Saved answer provenance:** the old saved block contained a raw `[@근거1]` and duplicate plain reference labels, with no navigable reference. Capture agent is correcting serialization and deduplication. Added a Notes renderer widget for validated `prism://paper` Markdown links; it invokes the existing evidence-open event. URL validation and TypeScript checks pass; native verification follows the integrated restart.
- **Unnecessary context:** the one-sentence question showed about 14.5K context despite explicitly attaching one sentence. The full-paper scope remained selected. This is a real cost/discoverability consideration; the reviewer did not infer exact billing from that display.
- **P2 insertion location:** on a new concept, adding evidence before placing the caret inserts the evidence above the H1 title. The source survives, but the document reads awkwardly. A new-note evidence action should default beneath the title or into a source section.
- **P2 chooser dismissal:** Escape did not close the relation chooser; its X did.
- **Ontology discoverability:** the concept relation chooser offers only `확장함` and compatible concepts; source papers are found under the separate **근거** action. That separation prevents an invalid relation, but the chooser should explain why papers are absent. No scientifically false link was created merely to make a graph look connected.

The source-card return path works. New saved-chat links and the newly visible memo jump require the integrated follow-up check; this review does not yet claim those paths passed.

## Integrated follow-up — PID 16620

Re-saved the cached answer without another model call. The new block contains one attributed source link and a linked inline citation. In Notes, **메모 보기** was visible and reached the existing `Notes` section; expanding the new block showed the complete answer and reference. Clicking the reference opened engineering page 11 and highlighted the exact ratio definition. [Saved reference UI](images/saved-answer-links.png). The old block remained intact.

The memo jump initially put its heading near the lower edge of the viewport, so its scroll alignment has now been changed to the top. The relation chooser Escape handler and initial block insertion position are fixed in code, with explicit body-caret preservation covered by a regression. Neutral **관련** is now offered before stronger semantic relations for distinct nodes; support and contradiction restrictions remain unchanged. This lets the researcher connect a concept to a paper without inventing an extension claim. Tests and TypeScript pass; these last refinements await the final integrated screen check.
# Final integrated native verification

PID 16620, both renderer windows reloaded to the integrated build. No additional AI calls were made in this final check.

- **Memo discovery passed:** `메모 보기` found the existing English `Notes` heading and placed all three saved answer summaries in the visible viewport. Expanding the newest summary exposed the full image answer and attributed source link.
- **Neutral knowledge relation passed:** opened the existing `기공 형상 계수` concept, opened `관계`, confirmed `관련` was the default neutral option, pressed Escape to dismiss it, reopened it and selected the engineering paper. The property, two-node graph and incoming paper relation updated. The saved concept Markdown contains `related` and an ordinary vault-relative wiki link. Existing evidence and authored text remained intact.
- **Source return from Korean-only passed:** with only the Korean reader pane open on page 4, clicking the saved text answer's page 11 reference reopened the original pane, moved to actual page 11 and highlighted the cited sentence after rendering settled.
- **Image answer persistence and return passed:** saved the already completed image answer without rerunning a model. The Markdown contains both numbered visual observations and `prism://paper/local-6f1c8cd4d2e4ef2b696770a8?anchor=figure-p4-mtu872cx&page=4`. Clicking its rendered reference returned to actual page 4 with Figure 2 visible.
- First-evidence placement below the H1 was regression-tested by `test-note-insertion.mjs`; no extra disposable concept was created in this final native pass. The older test concept retains its previously inserted evidence above the H1, intentionally preserving the existing file.

Evidence: `tmp/ui/round8/neutral-related-persisted.png`, `source-from-korean-only.png`, `saved-image-answer.png`, `saved-image-return-source.png`.

Remaining P2 polish: returning to a source from Korean-only currently opens a narrow side-by-side comparison when chat is visible (roughly 300 px per paper pane). Navigation succeeds, but a stacked layout or source-only focus would be more comfortable at this width. The active editable callout header can expose Markdown syntax; inactive newly saved blocks render cleanly. Neither issue blocked reading saved content or returning to evidence.

Follow-up: source reopening now chooses a stacked layout below 960 px workspace width. The product UI regression opens a saved reference with chat visible and confirms the source pane remains wider than 500 px. Native citation return also opens the original page; precise whole-figure centering remains a separate limitation.
