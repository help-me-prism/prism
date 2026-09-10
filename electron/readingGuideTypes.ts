export type GuideAnchor = { id: string; source: string; page: number; type: string; sectionTitle?: string }
export type GuidePoint = { anchorId: string; text: string; kind: 'finding' | 'method' | 'limit'; page: number }
export type ReadingGuide = { sourceHash: string; summary: string; points: GuidePoint[]; sampled: boolean; model: string; generatedAt: number }
