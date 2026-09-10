# Actual figure-image chat review

Native Windows review, 2026-09-10. Current fixture process16620; exclusive screen ownership coordinated with the notes reviewer. No product edits during this review.

## Result

**Passed one real image question using Codex GPT-5.6 Luna.** The answer exactly identifies both green labels on the right of Figure2 and the two photographs beneath each label. The model received actual image pixels, not only the caption or an image filename.

## Native steps and independent ground truth

1. Started a fresh chat using the chat-header plus button; confirmed Codex / GPT-5.6 Luna.
2. Entered4 in the page field and pressed Return to navigate the original and Korean panes.
3. Scrolled to engineering Figure2 and clicked the detected full composite figure. The composer showed a thumbnail preview and a p.4 figure reference.
4. Asked once: “첨부한 이미지에서 오른쪽 파란 점선 상자 안의 초록색 제목 두 개를 위에서 아래 순서대로 영어 원문 그대로 적고, 각 제목 아래 사진이 몇 장인지 알려줘. 캡션이나 논문 본문이 아니라 실제 보이는 글자와 사진만 근거로 답하고 읽기 어려우면 그렇게 말해줘.”
5. Observed the completed answer without retry:
   - Pouring FRFC into a test mold — 사진2장
   - Hardened test specimen — 사진2장

Both match the official source PDF rendered independently before asking. Figure caption is only “Preparation process of FRFC”; it does not supply these two visible green labels or photograph counts. Paper: Li et al., DOI10.1371/journal.pone.0287690, PLOS ONE, CC BY.

## Transport evidence

Saved asset: `tmp/prism-product-ui-persona-xJpKBJ/vault/papers/local-6f1c8cd4d2e4ef2b696770a8/figures/figure-p4-mtu872cx.png`,118,224bytes.

The task-scoped Codex rollout `rollout-2026-09-10T00-01-11-01a086af-ed39-7c52-901d-2c2d6b488c82.jsonl` contains the exact saved image path wrapper and an actual `input_image` content item (data-URL length157,654). Only this review's input types/path and answer were inspected; image payload is not copied into the repository report.

Native screenshot: [Figure chat screenshot](images/figure-chat-actual-image.png) shows the PDF figure and matching answer together.

## Limits

The initial Codex check verifies one small-label composite figure, one image attachment, and one actual Luna turn. It does not establish accuracy for arbitrary scientific images, unreadable scans, multiple simultaneous images, or macOS. A separately authorized Claude Haiku check is recorded below; neither provider was retried.

## Actual token accounting for this image turn

Read only this known image-test rollout's final `token_count.info.last_token_usage`:

| Field | Value |
|---|---:|
| input_tokens | 14,804 |
| cached_input_tokens | 6,912 |
| cache_write_input_tokens | 0 |
| output_tokens | 109 |
| reasoning_output_tokens | 65 |
| total_tokens | 14,913 |

The typed question contained142characters. The app-assembled user prompt (instructions, paper context, typed question, and attachment-order text) contained7,294characters. The screenshot's approximately14.9K context value is not evidence that14.9K newly uncached tokens were billed: the reported input includes6,912cached tokens. Arithmetic noncached input is7,892tokens. These are runtime usage fields, not a monetary bill or a verified subscription-quota formula; reasoning output must not be added again to total without a documented accounting rule. Image tokens and CLI/system overhead cannot be separately attributed from this aggregate record. No prompt content, base64 payload, or system instructions were exported for this accounting check.

## Separate actual Claude Haiku image check

After native UI release, started a fresh chat, selected Claude / Claude Haiku, opened original p4 at full reader width, clicked Figure2, verified its preview, and submitted one question asking the same two labels and photograph counts. The CLI completed normally. The answer correctly counted2photos under each heading, but explicitly said the green labels were too low resolution to read. Its tentative top-label guess “Forming FRFC...” is incorrect; the correct top label is “Pouring FRFC into a test mold”. The lower heading was left unreadable. This is a **transport pass with a visual-reading limitation**, not full visual accuracy success. No retry.

The exported asset `figure-p4-mtu8o17d.png` is457×165pixels,118,224bytes. The earlier Luna asset is the same size. Thus the successful Luna result must not hide the low-resolution capture limitation exposed by Haiku. The source PDF contains finer detail than this saved crop; preserving more source pixels is a concrete next improvement.

Verified the exact app session's providerThreadId `7c110623-82a2-4043-bd38-26aecdc872fb` against its Claude transcript. The user message contains7,276text characters and an actual `image` content block with `source.type=base64`, `media_type=image/png`, and157,632base64 characters. Resolved model is `claude-haiku-4-5-20251001`. Native evidence: `tmp/ui/figure-chat-haiku-actual.png`.

Claude usage fields for this one turn: input_tokens10; cache_creation_input_tokens26,167; cache_read_input_tokens0; output_tokens1,518; thinking_tokens1,285 within output_tokens_details. No web search/fetch requests reported. These provider counters differ from Codex's accounting schema and must not be compared as if cache creation were absent or output thinking were an extra additive total. Monetary charges/subscription quota consumption were not inferred. The context display was approximately27.7K.

## High-resolution capture fix: actual Haiku retest

After the parent fixed PDF-region rendering, reloaded the compiled app with Ctrl+R, started a fresh Claude Haiku chat, and recaptured the complete same Figure2. New file `figure-p4-mtu8wqeh.png` is1,830×661pixels and1,396,227bytes, compared with the earlier457×165 crop. Verified the fresh thumbnail before sending the identical label/count question once.

**Passed:** Haiku now returned both exact labels, “Pouring FRFC into a test mold” and “Hardened test specimen”, in order, with2photographs each. It included a clickable p.4 evidence citation. Screenshot: [Haiku high-resolution answer](images/figure-chat-haiku-highres.png). This is a bounded retest after a concrete resolution fix, not repeated sampling of unchanged input. No high model used.

From Korean-only reading, clicking the new answer citation opened comparison mode with the original p4 visible. The source pane showed the upper part of the figure near its lower viewport edge; it did not center the whole figure. This verifies opening the source pane/page, not perfect figure-centering behavior.

Exact Claude provider thread for the high-resolution retest: `71a90609-7c2d-4a31-bbdf-8cc535baf301`.
The transcript contains actual image content (normalized there to image/jpeg,369,136base64characters). Model: claude-haiku-4-5-20251001. Usage: input_tokens10, cache_creation_input_tokens6,925, cache_read_input_tokens20,316, output_tokens522 (thinking430 within output details); no web calls. The substantial cache read explains why the approximately27.8K context display is not27.8K newly uncached input.
