// Test-only native file picker adapter. Production never imports this entry point.
const { dialog, app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.PRISM_PRODUCT_TEST_ROOT
if (!root || !path.basename(root).startsWith('prism-product-ui-')) throw new Error('An isolated fixture directory is required')
app.setPath('userData', path.join(root, 'profile'))
dialog.showOpenDialog = async (...args) => {
  const options = args.at(-1)
  const file = options.properties.includes('openFile') ? fs.readFileSync(path.join(root, 'selection.txt'), 'utf8') : path.join(root, 'external-papers')
  return { canceled: false, filePaths: [file] }
}
import('../dist-electron/main.js')
