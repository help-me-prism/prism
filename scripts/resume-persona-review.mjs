import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const session = JSON.parse(await fs.readFile('tmp/persona-session.json', 'utf8'))
const child = spawn(require('electron'), [`--remote-debugging-port=${session.port}`, `--user-data-dir=${session.profile}`, 'scripts/product-test-host.cjs'], { windowsHide: false, stdio: 'ignore', detached: true, env: { ...process.env, PRISM_PRODUCT_TEST_ROOT: session.root, PRISM_TEST_DISABLE_AUTO_TRANSLATE: '1', PRISM_TEST_WINDOW_SIZE: '1280x900' } })
child.unref()
await fs.writeFile('tmp/persona-session.json', JSON.stringify({ ...session, pid: child.pid }, null, 2))
console.log(`Review session resumed: ${child.pid}`)
