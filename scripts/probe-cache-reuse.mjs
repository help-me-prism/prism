// How much of a saved translation still matches after a segmentation change.
// The reader reuses a cached sentence by id, then by its normalised source text.
import fs from 'node:fs/promises'
import path from 'node:path'
import { segmentsForPdf } from './audit-translation-quality.mjs'

const normalise = (value) => value.replace(/\s+/g, ' ').trim()
for (const dir of process.argv.slice(2)) {
  const cached = JSON.parse(await fs.readFile(path.join(dir, 'translation.ko.json'), 'utf8')).segments ?? []
  const translated = cached.filter((segment) => segment.translation && ['text', 'heading', 'caption'].includes(segment.kind))
  const byId = new Map(translated.map((segment) => [segment.id, segment]))
  const bySource = new Map(translated.map((segment) => [normalise(segment.source), segment]))
  const { flat } = await segmentsForPdf(path.join(dir, 'original.pdf'))
  const current = flat.filter((segment) => ['text', 'heading', 'caption'].includes(segment.kind))
  const byIdHits = current.filter((segment) => byId.has(segment.id)).length
  const bySourceHits = current.filter((segment) => !byId.has(segment.id) && bySource.has(normalise(segment.source))).length
  console.log(`${path.basename(dir).padEnd(32)} cached ${String(translated.length).padEnd(5)} current ${String(current.length).padEnd(5)} reused ${byIdHits + bySourceHits} (id ${byIdHits}, text ${bySourceHits})`)
}
