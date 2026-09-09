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

## Follow-up after improving the actual input: grounded suggestions passed

The parent changed the source sampling to cover later paper material and supplied bounded registry-verified PDF quotations even without manually captured note cards. A fresh backend, PID 23948 / port 9351, was reviewed with one separately authorized additional Luna call. This was a changed-input retest, not an unchanged automatic retry. Total ontology calls across these two checks: two, both GPT-5.6-Luna.

Before that call, the reviewer created a **manual test Claim through the Notes UI**, not an AI-generated user belief: “이 논문의 시험 조건에서 질량분율 1% GF·PVAF·PPF 첨가는 무보강 발포 콘크리트보다 열전도도를 낮춘다”. The Claim origin stayed “논문의 주장”; domain was set to “발포 콘크리트” and regime to “논문 시험 조건, 질량분율 1% GF·PVAF·PPF”. The actual page-15 conclusion `p15-s18-3mco9m` was checked before choosing this scope. Fiber-specific percentage ordering differs between passages in the original paper, so the test Claim intentionally asserted only the common reduction result, not a ranking or exact per-fiber percentage.

The run completed at `2026-09-09T16:12:43.954Z`, with **2 relations created, 0 skipped, 2 paper-claim candidates, and no new concepts or memo candidates**. Both relationships stayed pending:

| Proposed relation | Actual registered PDF evidence | Assessment |
| --- | --- | --- |
| Engineering paper **supports** the manual test Claim | Page 1, `p1-s17-17sqt0`: compares GF/PVAF/PPF at 1% mass fraction with fiber-free FC and reports decreases of 20.73%, 18.23%, and 7.00%. | Matches the tested materials, 1% mass fraction, comparator, and direction. The Claim explicitly limits its scope to this paper's tests. |
| Engineering paper **uses** the existing pore-shape-factor concept | Page 11, `p11-s3-syk2f8`: describes the ratio of pores sharing a shape-factor value to the total pores in Fig. 12. | Directly demonstrates use of the concept. It avoids claiming that this paper introduced the general concept. |

The two paper-claim candidates concern improved pore roundness / the proportion below 400 μm and relatively low thermal conductivity at 1% fiber mass fraction. They match supplied paper statements and were left pending. No false contradiction or unrelated cross-discipline relationship was proposed in this case. No approvals or additional model calls were made.

Evidence: [manually created scoped test Claim](images/round12-scoped-test-claim.png), [grounded relations and paper claims awaiting review](images/round12-grounded-pending.png).

This confirms one positive, source-grounded supports/uses case after the sampling repair. It does not establish broad scientific correctness across papers, contradiction detection, or automatic research judgment. Native UI was released after capture.

## Approval-flow follow-up: evidence navigation issue found

Before approving the matching supports relation, clicked its “근거: 문장14 (p.1)” label in the native curation queue. It opened the source paper **note**, not the cited PDF sentence. Read-only code inspection confirmed the label is inside the row's `onOpenNode` button in `CurationQueue.tsx`, with no evidence-navigation action. Approval was deliberately left pending and the issue reported for a direct PDF-evidence control. No additional AI call was made. The eventual approval outcome is not yet verified at this point.

## Fixed approval flow: native end-to-end passed

After rebuilding and reloading the same Notes window, the queue offered a separate **원문 근거 열기 · 문장14 (p.1)** button. Clicking it opened the Reader at **1 / 17**, centered the abstract's relevant passage in the original pane, and highlighted exactly the comparison of 1% GF/PVAF/PPF with fiber-free FC. The actual visible sentence confirmed the scoped test Claim.

Returned to the queue and approved only that supports relationship. The UI displayed the approval notice; the relation disappeared from the pending list, while the uses relation stayed pending. Opening the test Claim showed **지지함 (받음): engineering-foamed-concrete**, a support line in its graph, and the corresponding supporting-paper link under **지지 근거**.

Read-only persistence verification confirmed `relation-5a3a2dba-0bd3-484c-a2c8-3b605370d232` now has `reviewStatus: approved`, still `creator: ai`, with its original evidence metadata unchanged: paper `local-6f1c8cd4d2e4ef2b696770a8`, anchor `p1-s17-17sqt0`, type `sentence`, page 1, label `문장14`. No extra AI requests were made during source verification or approval.

Evidence: [actual PDF source sentence highlighted](images/round12-support-source-highlight.png), [approved incoming support and graph](images/round12-approved-incoming.png). No further blocking issue was observed in this bounded flow. Native UI released.
