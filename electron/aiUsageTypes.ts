export type AiUsage = { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number }
export type InputComposition = { question: number; paperEvidence: number; selectedEvidence: number; instructions: number }
export type AiRun = AiUsage & { inputComposition?: InputComposition; measurement?: 'last-request'; id: string; task: string; provider: string; model: string; startedAt: number; durationMs: number; inputCharacters: number; status: 'completed' | 'failed' }
