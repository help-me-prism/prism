// Live end-to-end check: real PDF -> real segmentation and scope -> real CLI ->
// the same validation the reader uses. Spends model tokens, so it takes an
// explicit page range and prints what the reader would show.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cliTaskArgs, taskInstructions } from '../dist-electron/cliTaskOptions.js'
import { prepareTranslationRequest, inspectTranslationRequest, translationBatches } from '../dist-electron/translationHarness.js'
import { withoutBibliography } from '../dist-electron/translationScope.js'
import { segmentsForPdf } from './audit-translation-quality.mjs'

const [target, pageRange = '1', provider = 'codex', model = 'gpt-5.6-luna'] = process.argv.slice(2)
if (!target) throw new Error('Usage: node scripts/live-translation-check.mjs <paper-dir|pdf> <page|from-to> [provider] [model]')
const [from, to] = pageRange.split('-').map(Number)
const wanted = (page) => page >= from && page <= (to ?? from)

const pdfPath = target.endsWith('.pdf') ? target : path.join(target, 'original.pdf')
const { flat } = await segmentsForPdf(pdfPath)
const body = new Set(withoutBibliography(flat).map((segment) => segment.id))
const translatable = flat.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind)
  && segment.source.trim().length > 1 && body.has(segment.id) && wanted(segment.page))
if (!translatable.length) throw new Error(`No translatable segment on page ${pageRange}`)

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-live-translation-'))
const instructionsFile = path.join(cwd, 'instructions.txt')
await fs.writeFile(instructionsFile, taskInstructions, 'utf8')

function runCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(provider, cliTaskArgs(provider, model, instructionsFile), { cwd, env: { ...process.env, NO_COLOR: '1' }, windowsHide: true, shell: process.platform === 'win32' })
    let stdout = ''; let stderr = ''
    child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `${provider} exited with ${code}`))
      if (provider === 'claude') return resolve(JSON.parse(stdout).result ?? '')
      let final = ''
      for (const line of stdout.split(/\r?\n/)) {
        try {
          const event = JSON.parse(line)
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') final = event.item.text
        } catch { /* non-JSON diagnostic line */ }
      }
      resolve(final)
    })
    child.stdin.end(prompt)
  })
}

const ordered = flat.filter((segment) => wanted(segment.page))
const contextFor = (input) => {
  const first = ordered.findIndex((segment) => segment.id === input[0].id)
  const last = ordered.findIndex((segment) => segment.id === input.at(-1).id)
  return 'Before target:\n' + ordered.slice(Math.max(0, first - 3), first).map((segment) => segment.source).join(' ').slice(-1000)
    + '\nAfter target:\n' + ordered.slice(last + 1, last + 4).map((segment) => segment.source).join(' ').slice(0, 900)
}

const batches = translationBatches(translatable, contextFor)
console.log(`${path.basename(path.dirname(pdfPath))} p${pageRange}: ${translatable.length} segments in ${batches.length} batch(es) via ${provider}/${model}`)
const accepted = new Map(); const rejected = []
const started = Date.now()
for (const input of batches) {
  const request = prepareTranslationRequest(input, contextFor(input))
  const checked = inspectTranslationRequest(await runCli(request.prompt), request)
  for (const [id, text] of checked.accepted) accepted.set(id, text)
  rejected.push(...checked.rejected)
}
await fs.rm(cwd, { recursive: true, force: true })

console.log(`accepted ${accepted.size}/${translatable.length}, rejected ${rejected.length}, ${Math.round((Date.now() - started) / 1000)}s`)
for (const item of rejected) console.log(`  REJECTED ${item.id}: ${item.reason}`)
for (const segment of ordered.filter((item) => wanted(item.page))) {
  const state = accepted.has(segment.id) ? '' : body.has(segment.id) && ['text', 'heading', 'caption'].includes(segment.kind) ? ' [UNTRANSLATED]' : ' [source]'
  console.log(`\n[${segment.kind}]${state} ${segment.source.slice(0, 200)}`)
  if (accepted.has(segment.id)) console.log(`  -> ${accepted.get(segment.id)}`)
}
