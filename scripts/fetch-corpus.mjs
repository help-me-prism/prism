// Downloads the audit corpus described by scripts/corpus/manifest.json into
// tmp/corpus/<split>/, which git ignores. The first successful fetch of a paper
// records its SHA-256 in scripts/corpus/lock.json, so everyone auditing the
// corpus is measuring the same bytes: a publisher silently reissuing a PDF would
// otherwise move the baseline without anyone changing a rule.
//
//   node scripts/fetch-corpus.mjs            # both splits, skip what is present
//   node scripts/fetch-corpus.mjs holdout    # one split
//   node scripts/fetch-corpus.mjs --recheck  # re-hash what is already on disk
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const manifestPath = 'scripts/corpus/manifest.json'
const lockPath = 'scripts/corpus/lock.json'
const root = 'tmp/corpus'
// Publishers serve the article to a browser and a bot check to everything else,
// so the fetch has to look like a browser or it silently collects HTML.
const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', accept: 'application/pdf,*/*' }

const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')
const readJson = async (file, fallback) => { try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback } }

const manifest = await readJson(manifestPath)
if (!manifest) throw new Error(`missing ${manifestPath}`)
const lock = await readJson(lockPath, {})

const args = process.argv.slice(2)
const recheck = args.includes('--recheck')
const wanted = args.filter(arg => !arg.startsWith('--'))
const splits = Object.keys(manifest.splits).filter(split => wanted.length === 0 || wanted.includes(split))

const report = { fetched: [], cached: [], changed: [], failed: [] }
for (const split of splits) {
  await fs.mkdir(path.join(root, split), { recursive: true })
  for (const paper of manifest.splits[split]) {
    const file = path.join(root, split, `${paper.id}.pdf`)
    const key = `${split}/${paper.id}`
    const onDisk = await fs.readFile(file).catch(() => null)
    if (onDisk && !recheck) { report.cached.push(key); continue }

    let bytes = onDisk
    // A paper the reader owns but no one can download — paywalled, or a PDF the
    // user added themselves. It is copied from where it already is, and simply
    // skipped on a machine that does not have it.
    if (!bytes && paper.local) {
      bytes = await fs.readFile(paper.local).catch(() => null)
      if (!bytes) { report.failed.push(`${key}: local file not present (${paper.local})`); continue }
    }
    if (!bytes) {
      try {
        const response = await fetch(paper.url, { headers, redirect: 'follow' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        bytes = Buffer.from(await response.arrayBuffer())
        // A bot check answers 200 with an HTML page. Catching it here keeps a
        // login wall out of the corpus instead of letting pdf.js fail later.
        if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF (bot check or paywall)')
      } catch (error) {
        report.failed.push(`${key}: ${error.message}`)
        continue
      }
    }

    const digest = sha256(bytes)
    if (lock[key] && lock[key].sha256 !== digest) report.changed.push(`${key}: ${lock[key].sha256.slice(0, 12)} -> ${digest.slice(0, 12)}`)
    else if (!lock[key]) lock[key] = { sha256: digest, bytes: bytes.length, url: paper.url, fetched: new Date().toISOString().slice(0, 10) }
    if (!onDisk) { await fs.writeFile(file, bytes); report.fetched.push(key) }
  }
}

await fs.writeFile(lockPath, JSON.stringify(Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n')

console.log(`fetched ${report.fetched.length}, cached ${report.cached.length}, failed ${report.failed.length}`)
for (const line of report.failed) console.log(`  FAILED  ${line}`)
// A changed hash is not fixed automatically: the baseline it invalidates is a
// judgement call, not a download.
for (const line of report.changed) console.log(`  CHANGED ${line}  (corpus drifted; baseline is no longer comparable)`)
if (report.failed.length) console.log('\nFailures are expected for publishers behind bot checks. Drop the entry from the manifest rather than working around the check.')
