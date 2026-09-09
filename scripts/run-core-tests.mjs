import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
for (const file of readdirSync('scripts').filter(file => /^test-.*\.mjs$/.test(file) && !file.endsWith('-ui.mjs')).sort()) {
  const result = spawnSync(process.execPath, [`scripts/${file}`], { stdio: 'inherit', windowsHide: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
