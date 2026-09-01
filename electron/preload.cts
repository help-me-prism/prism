const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

function subscribe(channel: string, callback: (payload: unknown) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('prism', {
  listProviders: () => ipcRenderer.invoke('providers:list'),
  loadSessions: () => ipcRenderer.invoke('sessions:load'),
  saveSessions: (sessions: unknown) => ipcRenderer.invoke('sessions:save', sessions),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: unknown) => ipcRenderer.invoke('settings:update', settings),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listLibrary: () => ipcRenderer.invoke('library:list'),
  searchArxiv: (input: string) => ipcRenderer.invoke('arxiv:search', input),
  openArxiv: (arxivId: string) => ipcRenderer.invoke('arxiv:open', arxivId),
  downloadPaper: (paper: unknown) => ipcRenderer.invoke('paper:download', paper),
  readPaperPdf: (arxivId: string) => ipcRenderer.invoke('paper:pdf', arxivId),
  readPaperNote: (arxivId: string) => ipcRenderer.invoke('paper:note:read', arxivId),
  savePaperNote: (arxivId: string, content: string) => ipcRenderer.invoke('paper:note:save', arxivId, content),
  readTranslation: (arxivId: string) => ipcRenderer.invoke('translation:read', arxivId),
  startTranslation: (arxivId: string, segments: unknown) => ipcRenderer.invoke('translation:start', arxivId, segments),
  cancelTranslation: (arxivId: string) => ipcRenderer.invoke('translation:cancel', arxivId),
  sendMessage: (request: unknown) => ipcRenderer.invoke('chat:send', request),
  cancelMessage: (sessionId: string) => ipcRenderer.invoke('chat:cancel', sessionId),
  onChatEvent: (callback: (event: unknown) => void) => subscribe('chat:event', callback),
  onChatDone: (callback: (event: unknown) => void) => subscribe('chat:done', callback),
  onChatError: (callback: (event: unknown) => void) => subscribe('chat:error', callback),
  onTranslationProgress: (callback: (event: unknown) => void) => subscribe('translation:progress', callback),
  onTranslationDone: (callback: (event: unknown) => void) => subscribe('translation:done', callback),
  onTranslationError: (callback: (event: unknown) => void) => subscribe('translation:error', callback),
})
