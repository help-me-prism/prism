/// <reference types="vite/client" />

type ProviderId = 'codex' | 'claude'
type ProviderModel = { id: string; name: string; description: string }
type ProviderInfo = { id: ProviderId; name: string; available: boolean; status: string; models: ProviderModel[] }
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number }
type ChatSession = { id: string; title: string; provider: ProviderId; model: string; providerThreadId?: string; messages: ChatMessage[]; createdAt: number; updatedAt: number }
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }

interface Window {
  prism: {
    listProviders: () => Promise<ProviderInfo[]>
    loadSessions: () => Promise<ChatSession[]>
    saveSessions: (sessions: ChatSession[]) => Promise<boolean>
    sendMessage: (request: ChatRequest) => Promise<{ started: boolean }>
    cancelMessage: (sessionId: string) => Promise<boolean>
    onChatEvent: (callback: (event: unknown) => void) => () => void
    onChatDone: (callback: (event: unknown) => void) => () => void
    onChatError: (callback: (event: unknown) => void) => () => void
  }
}
