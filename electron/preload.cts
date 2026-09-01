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
  sendMessage: (request: unknown) => ipcRenderer.invoke('chat:send', request),
  cancelMessage: (sessionId: string) => ipcRenderer.invoke('chat:cancel', sessionId),
  onChatEvent: (callback: (event: unknown) => void) => subscribe('chat:event', callback),
  onChatDone: (callback: (event: unknown) => void) => subscribe('chat:done', callback),
  onChatError: (callback: (event: unknown) => void) => subscribe('chat:error', callback),
})
