# A first claim directly from evidence

An evidence card previously offered connections only to claims that already existed. A researcher can now enter a claim title in that picker, choose supports, contradicts or extends, and create the claim with the selected source embedded in its Markdown. The relationship retains the exact paper, anchor, page and user-selected type. No AI inference is involved.

The source draft is saved before creation. Continued edits or changed document ownership stop subsequent UI operations. An immediate busy guard prevents repeated activation from creating several claims. Once created, the claim is retained for retry if relationship creation fails and can be opened for review. Successful connections show completion rather than inviting a duplicate retry; an existing title directs the reader to the existing claim list.

Creation and relation requests carry the registered vault token from the source snapshot. As with note saves, an in-flight operation stays in that original vault if settings change. Unknown or empty supplied tokens fail rather than falling back to another vault. Explicit note bodies are literal content: source text containing `{{title}}` or `{{date}}` is not expanded as a template.

## Verification scope

The integrated build and core suite passed. Product UI checks creating and relating a claim after a vault switch, absence from the newly selected vault, invalid-token rejection and malformed-body rejection. The literal-source regression checks template-like quoted text. A Product UI retry exposed an existing resize timing assumption before a figure click; the test now waits for that figure's rendered button.

Notes UI checks typed-title creation, explicit extends relation, exact evidence metadata and literal source/PDF link, immediate repeated activation, a single claim/relation, the successful state on reopening the picker, and opening the claim. Injected partial relation failure is not covered by this UI test and is not claimed as verified.

## Independent visual criticism

The reader's visual quality is not approved by this change. The independent critic identified comparison text becoming too small with chat open, mismatched density between Korean typesetting and preserved PDF elements, and excessive visible configuration controls. Paper mode preserves horizontal source bounds and reading order but can expand vertically when translation is longer. It does not guarantee identical page height or every vertical position.

Native pointer review was obstructed by a Windows update modal. App-only CDP inspection is recorded separately; it must not be described as an unobstructed native interaction test or human taste approval. The full product goal remains active, including translation layout and meaning, first-time usability, cross-platform release verification and signing.

The [same-width engineering page 4 capture](images/round36-reader-p4.png) has original dimensions 481 × 622.469 px and translated dimensions 481 × 622.672 px. Both bundled UI and Korean serif fonts were loaded. This sample preserves the broad page arrangement but visibly differs in stroke density; it is not an overall typography approval. The [claim creation form](images/round36-claim-form.png) records the explicit title and relation before creation. The parent reviewer opened both captures.

Independent CDP interaction completed the engineering evidence → typed claim → explicit extends relation → [open claim](images/round36-claim-open.png) → [PDF source return](images/round36-claim-source-return.png) flow. The vault gained exactly one note, the claim retained its source card and m₀ notation, and returning to the source highlighted `p4-s6-y46jly` on page 4. This used the isolated copied vault and no inference. The unsigned Windows package matches 434 compiled files and passes the packaged first-launch smoke test.
