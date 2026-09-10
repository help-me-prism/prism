import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { refreshPaperDigest } from '../dist-electron/paperDigest.js'
import { migratePaperNotes } from '../dist-electron/knowledge.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-local-digest-'))
try {
  await fs.mkdir(path.join(root, '.prism', 'anchors'), { recursive: true })
  for (const hasAbstract of [true, false]) {
    const id = hasAbstract ? 'local-abstract-example' : 'local-methods-example'
    const directory = path.join(root, 'papers', id), notePath = path.join(directory, `${id}.md`)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(notePath, `---\ntype: paper\narxiv_id: "${id}"\ntitle: "Local experimental paper"\n---\n\n# Local experimental paper\n\n## 내 생각\n\nKeep my experimental caveat unchanged.\n`)
    const sentence = hasAbstract ? 'We describe a method for measuring the stiffness of a porous specimen.' : 'The samples were dried for twenty-four hours before testing.'
    await fs.writeFile(path.join(root, '.prism', 'anchors', `${id}.json`), JSON.stringify({ version: 1, paperId: id, anchors: [
      { id: 'h1', type: 'heading', source: hasAbstract ? 'Abstract' : 'Methods', page: 1 },
      { id: 's1', type: 'text', sectionTitle: hasAbstract ? 'Abstract' : 'Methods', source: hasAbstract ? `AU : Pleaseconfirmthatallheadinglevelsarerepresentedcorrectly : ${sentence}` : sentence, page: 1 },
    ] }))
    await migratePaperNotes(root)
    const result = await refreshPaperDigest(root, `paper-${id}`, [])
    assert.equal(result.usedModel, false)
    const saved = await fs.readFile(notePath, 'utf8')
    assert(saved.endsWith('Keep my experimental caveat unchanged.\n'))
    assert(!saved.includes('논문 본문과 초록을 아직 읽지 못했습니다'))
    if (hasAbstract) {
      assert(saved.includes(sentence), 'A local PDF abstract must populate the overview without requiring translation or an AI call')
      assert(!saved.includes('Pleaseconfirm'), 'Publisher production queries must not become a research overview')
    }
    else {
      assert(saved.includes('본문은 준비되어 있습니다'))
      assert(!saved.includes(sentence), 'Arbitrary methods text must not be presented as the abstract')
    }
  }
  console.log('Local paper digest passed: cached untranslated abstract, honest body-only state, no inference and preserved authored content.')
} finally {
  assert.equal(path.dirname(path.resolve(root)), await fs.realpath(os.tmpdir()))
  assert(path.basename(root).startsWith('prism-local-digest-'))
  await fs.rm(root, { recursive: true, force: true })
}
