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
  autocompletePapers: (input: string) => ipcRenderer.invoke('paper:autocomplete', input),
  openArxiv: (arxivId: string) => ipcRenderer.invoke('arxiv:open', arxivId),
  downloadPaper: (paper: unknown) => ipcRenderer.invoke('paper:download', paper),
  readPaperPdf: (arxivId: string) => ipcRenderer.invoke('paper:pdf', arxivId),
  readLatexStructure: (arxivId: string) => ipcRenderer.invoke('paper:latex-structure', arxivId),
  readPaperFigures: (arxivId: string) => ipcRenderer.invoke('paper:figures', arxivId),
  openNotes: () => ipcRenderer.invoke('notes:open'),
  readPaperNote: (arxivId: string) => ipcRenderer.invoke('paper:note:read', arxivId),
  savePaperNote: (arxivId: string, content: string) => ipcRenderer.invoke('paper:note:save', arxivId, content),
  savePaperFigure: (arxivId: string, figureId: string, dataUrl: string, metadata: unknown) => ipcRenderer.invoke('paper:figure:save', arxivId, figureId, dataUrl, metadata),
  readTranslation: (arxivId: string) => ipcRenderer.invoke('translation:read', arxivId),
  savePaperAnchors: (arxivId: string, anchors: unknown) => ipcRenderer.invoke('paper:anchors:save', arxivId, anchors),
  startTranslation: (arxivId: string, segments: unknown, options?: unknown) => ipcRenderer.invoke('translation:start', arxivId, segments, options),
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
