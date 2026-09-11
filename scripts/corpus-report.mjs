// The gate for extraction-rule changes. Runs the offline reader-composition
// audit over both corpus splits and compares the result to a recorded baseline.
// No model calls, so it is cheap enough to run on every change.
//
// The split exists because a rule tuned on the papers we happened to open proves
// nothing about the next PDF the user opens. `tune` is where we are allowed to
// look at individual failures; `holdout` only ever reports aggregates, so the
// number it produces stays an honest estimate of how the rules generalise
// instead of becoming another thing we fitted.
//
//   node scripts/corpus-report.mjs              # measure, compare to baseline
//   node scripts/corpus-report.mjs --baseline   # record the current numbers
//   node scripts/corpus-report.mjs --split tune # tune detail only
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { segmentsForPdf, auditSegments, scope } from './audit-translation-quality.mjs'

const manifest = JSON.parse(await fs.readFile('scripts/corpus/manifest.json', 'utf8'))
const baselinePath = 'scripts/corpus/baseline.json'
const args = process.argv.slice(2)
const record = args.includes('--baseline')
const only = args.includes('--split') ? args[args.indexOf('--split') + 1] : null

const pad = (value, width) => String(value).padEnd(width)
const rpad = (value, width) => String(value).padStart(width)
const rate = (count, pages) => pages ? (count / pages).toFixed(3) : '—'

async function measure(split) {
  const papers = manifest.splits[split]
  const results = []
  for (const paper of papers) {
    const file = path.join('tmp/corpus', split, `${paper.id}.pdf`)
    try {
      const { flat, numPages } = await segmentsForPdf(file)
      const findings = auditSegments(flat, numPages)
      const counts = {}
      for (const finding of findings) counts[finding.type] = (counts[finding.type] ?? 0) + 1
      results.push({ ...paper, pages: numPages, counts, total: findings.length, scope: scope(flat), findings })
    } catch (error) {
      // A PDF the extractor cannot open at all is a finding in its own right,
      // and hiding it would flatter the score.
      results.push({ ...paper, pages: 0, counts: {}, total: 0, error: error.message, findings: [] })
    }
  }
  return results
}

function aggregate(results) {
  const ok = results.filter(paper => !paper.error)
  const pages = ok.reduce((sum, paper) => sum + paper.pages, 0)
  const byType = {}
  for (const paper of ok) for (const [type, count] of Object.entries(paper.counts)) byType[type] = (byType[type] ?? 0) + count
  const group = key => {
    const out = {}
    for (const paper of ok) {
      const bucket = out[paper[key] ?? 'und'] ??= { papers: 0, pages: 0, findings: 0 }
      bucket.papers += 1; bucket.pages += paper.pages; bucket.findings += paper.total
    }
    return out
  }
  return { papers: ok.length, unreadable: results.length - ok.length, pages, findings: ok.reduce((sum, paper) => sum + paper.total, 0), byType, byFamily: group('family'), byLang: group('lang') }
}

const splits = only ? [only] : Object.keys(manifest.splits)
const measured = {}
for (const split of splits) measured[split] = await measure(split)

// tune is the split we are allowed to debug, so it prints papers and examples.
if (measured.tune) {
  const summary = aggregate(measured.tune)
  console.log(`=== tune (${summary.papers} papers, ${summary.pages} pages) — 개별 확인 허용 ===`)
  console.log(pad('paper', 30) + rpad('pages', 7) + rpad('findings', 10) + rpad('/page', 9))
  for (const paper of [...measured.tune].sort((a, b) => b.total / Math.max(1, b.pages) - a.total / Math.max(1, a.pages))) {
    console.log(pad(paper.id, 30) + rpad(paper.error ? '—' : paper.pages, 7) + rpad(paper.error ? 'UNREADABLE' : paper.total, 10) + rpad(paper.error ? '' : rate(paper.total, paper.pages), 9))
  }
  console.log(pad('TOTAL', 30) + rpad(summary.pages, 7) + rpad(summary.findings, 10) + rpad(rate(summary.findings, summary.pages), 9))
}

// holdout reports aggregates only. Naming the worst paper here would be the
// first step to fixing that paper, which is exactly what the split prevents.
if (measured.holdout) {
  const summary = aggregate(measured.holdout)
  console.log(`\n=== holdout (${summary.papers} papers, ${summary.pages} pages) — 집계만, 개별 열람 금지 ===`)
  console.log(`결함/쪽: ${rate(summary.findings, summary.pages)}   총 결함: ${summary.findings}   열 수 없던 PDF: ${summary.unreadable}`)
  console.log('\n' + pad('finding', 26) + rpad('count', 8) + rpad('/page', 9))
  for (const [type, count] of Object.entries(summary.byType).sort((a, b) => b[1] - a[1])) console.log(pad(type, 26) + rpad(count, 8) + rpad(rate(count, summary.pages), 9))
  for (const [label, groups] of [['family', summary.byFamily], ['language', summary.byLang]]) {
    console.log('\n' + pad(label, 16) + rpad('papers', 8) + rpad('pages', 7) + rpad('/page', 9))
    for (const [name, bucket] of Object.entries(groups).sort((a, b) => b[1].findings / Math.max(1, b[1].pages) - a[1].findings / Math.max(1, a[1].pages))) {
      console.log(pad(name, 16) + rpad(bucket.papers, 8) + rpad(bucket.pages, 7) + rpad(rate(bucket.findings, bucket.pages), 9))
    }
  }
}

const current = Object.fromEntries(splits.map(split => [split, aggregate(measured[split])]))
if (record) {
  await fs.writeFile(baselinePath, JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), splits: current }, null, 1) + '\n')
  console.log(`\n기준선 기록됨 -> ${baselinePath}`)
} else {
  const baseline = await fs.readFile(baselinePath, 'utf8').then(JSON.parse).catch(() => null)
  if (!baseline) console.log('\n기준선 없음. `node scripts/corpus-report.mjs --baseline` 으로 먼저 기록하세요.')
  else {
    console.log(`\n=== 기준선 대비 (${baseline.recorded}) ===`)
    let regressed = false
    for (const split of splits) {
      const was = baseline.splits[split], now = current[split]
      if (!was) continue
      const before = was.findings / Math.max(1, was.pages), after = now.findings / Math.max(1, now.pages)
      const delta = after - before
      // Only holdout can block: tune is allowed to move while a rule is being
      // worked on, and reading anything into it would defeat the split.
      const verdict = split === 'holdout' ? (delta > 1e-9 ? 'REGRESSION' : delta < -1e-9 ? '개선' : '동일') : '참고'
      if (verdict === 'REGRESSION') regressed = true
      console.log(`${pad(split, 10)} ${before.toFixed(3)} -> ${after.toFixed(3)}  (${delta >= 0 ? '+' : ''}${delta.toFixed(3)})  ${verdict}`)
      if (was.unreadable !== now.unreadable) console.log(`${pad('', 10)} 열 수 없던 PDF ${was.unreadable} -> ${now.unreadable}`)
    }
    if (regressed) { console.log('\nholdout 이 나빠졌습니다. 머지 금지.'); process.exitCode = 1 }
  }
}
