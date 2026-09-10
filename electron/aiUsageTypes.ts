export type AiUsage = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }
export type AiRun = AiUsage & { measurement?: 'last-request'; id: string; task: string; provider: string; model: string; startedAt: number; durationMs: number; inputCharacters: number; status: 'completed' | 'failed' }
