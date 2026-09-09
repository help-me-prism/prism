// Test-only native file picker adapter. Production never imports this entry point.
const { dialog, app, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.PRISM_PRODUCT_TEST_ROOT
if (!root || !path.basename(root).startsWith('prism-product-ui-')) throw new Error('An isolated fixture directory is required')
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
// Hidden CI windows must still finish PDF.js animation-frame rendering after a fit-to-width resize.
app.on('web-contents-created', (_event, contents) => contents.setBackgroundThrottling(false))
if (process.env.PRISM_PRODUCT_TEST_CHAT === '1') {
  const register = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => register(channel, async (...args) => {
    if (channel === 'providers:list') return [{ id: 'codex', name: 'Codex', installed: true, available: true, status: 'Offline UI test', models: [{ id: 'gpt-5.6-luna', name: 'Luna', description: 'Offline UI test' }] }]
    if (channel === 'evidence:list') await new Promise(resolve => setTimeout(resolve, 800))
    if (channel === 'paper:note:capture' && args[1]?.kind === 'chat' && fs.existsSync(path.join(root, 'answer-capture-gate.txt'))) {
      fs.writeFileSync(path.join(root, 'answer-capture-started.txt'), 'started')
      const deadline = Date.now() + 10000
      while (fs.existsSync(path.join(root, 'answer-capture-gate.txt'))) {
        if (Date.now() > deadline) throw new Error('Answer capture test gate was not released')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    // Race regressions use real IPC with an explicitly delayed fixture response.
    if (['evidence:backlinks', 'paper:note:capture'].includes(channel)) {
      const delayFile = path.join(root, channel === 'evidence:backlinks' ? 'backlinks-delay.txt' : 'capture-delay.txt')
      if (fs.existsSync(delayFile)) {
        const delay = Number(fs.readFileSync(delayFile, 'utf8'))
        if (Number.isFinite(delay) && delay > 0 && delay <= 5000) await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    if (channel === 'chat:send') { fs.appendFileSync(path.join(root, 'unexpected-chat-call.txt'), JSON.stringify(args[1]) + '\n'); throw new Error('Offline UI test prevents paid calls') }
    return listener(...args)
  })
}
dialog.showOpenDialog = async (...args) => {
  const options = args.at(-1)
  const file = options.properties.includes('openFile') ? fs.readFileSync(path.join(root, 'selection.txt'), 'utf8') : fs.existsSync(path.join(root, 'directory-selection.txt')) ? fs.readFileSync(path.join(root, 'directory-selection.txt'), 'utf8') : path.join(root, 'external-papers')
  return { canceled: false, filePaths: [file] }
}
import('../dist-electron/main.js')
