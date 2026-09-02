/// <reference types="vite/client" />

type ProviderId = 'codex' | 'claude'
type ProviderModel = { id: string; name: string; description: string }
type ProviderInfo = { id: ProviderId; name: string; available: boolean; status: string; models: ProviderModel[] }
type ContextAnchor = { paperId: string; paperTitle: string; anchorId: string; type: 'sentence' | 'equation' | 'figure' | 'page'; page: number; label: string; source: string; preview?: string }
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number; anchors?: ContextAnchor[] }
type ChatSession = { id: string; title: string; provider: ProviderId; model: string; providerThreadId?: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; deletedAt?: number }
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type AppSettings = { libraryPath?: string; translationProvider: ProviderId; translationModel: string; autoTranslate: boolean }
type ArxivPaper = { arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string; categories: string[]; pdfUrl: string; absUrl: string; citationCount?: number }
type PaperRecord = ArxivPaper & { pdfPath: string; notePath: string; translationPath: string; sourcePath?: string; downloadedAt: number }
type PaperFigureAsset = { id: string; order: number; caption?: string; sourcePath?: string; mimeType?: string; dataUrl?: string }
type LatexBlock = { id: string; kind: 'heading' | 'paragraph' | 'caption' | 'equation' | 'figure' | 'table'; source: string; section?: string }
type LatexStructure = { version: 2; rootFile: string; generatedAt: string; blocks: LatexBlock[] }
type TranslationSegment = { id: string; page: number; source: string; kind: 'text' | 'heading' | 'caption' | 'equation' | 'artifact'; itemIndexes?: number[]; itemSlices?: Array<{ itemIndex: number; start: number; end: number }>; translation?: string; sourceMode?: 'latex' | 'pdf'; blockId?: string; sectionTitle?: string; paragraphContext?: string }
type TranslationCache = { version: number; provider: ProviderId; model: string; sourceHash: string; segments: TranslationSegment[] }
type WorkspaceCommand = { id: number; type: 'search' | 'choose-folder' | 'open-paper' | 'navigate-anchor'; paperId?: string; anchor?: ContextAnchor }
type WorkspaceSnapshot = { library: PaperRecord[]; openPaperIds: string[]; activePaperId?: string; libraryPath?: string }

interface Window {
  prism: {
    listProviders: () => Promise<ProviderInfo[]>
    loadSessions: () => Promise<ChatSession[]>
    saveSessions: (sessions: ChatSession[]) => Promise<boolean>
    getSettings: () => Promise<AppSettings>
    updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
    chooseWorkspace: () => Promise<AppSettings | null>
    listLibrary: () => Promise<PaperRecord[]>
    searchArxiv: (input: string) => Promise<ArxivPaper[]>
    autocompletePapers: (input: string) => Promise<Array<{ title: string; authorsYear?: string }>>
    openArxiv: (arxivId: string) => Promise<void>
    downloadPaper: (paper: ArxivPaper) => Promise<PaperRecord>
    readPaperPdf: (arxivId: string) => Promise<Uint8Array>
    readLatexStructure: (arxivId: string) => Promise<LatexStructure | null>
    readPaperFigures: (arxivId: string) => Promise<PaperFigureAsset[]>
    openNotes: () => Promise<boolean>
    readPaperNote: (arxivId: string) => Promise<string>
    savePaperNote: (arxivId: string, content: string) => Promise<boolean>
    savePaperFigure: (arxivId: string, figureId: string, dataUrl: string, metadata: unknown) => Promise<string>
    readTranslation: (arxivId: string) => Promise<TranslationCache | null>
    savePaperAnchors: (arxivId: string, anchors: TranslationSegment[]) => Promise<boolean>
    startTranslation: (arxivId: string, segments: TranslationSegment[], options?: { force?: boolean }) => Promise<{ started: boolean }>
    cancelTranslation: (arxivId: string) => Promise<boolean>
    sendMessage: (request: ChatRequest) => Promise<{ started: boolean }>
    cancelMessage: (sessionId: string) => Promise<boolean>
    onChatEvent: (callback: (event: unknown) => void) => () => void
    onChatDone: (callback: (event: unknown) => void) => () => void
    onChatError: (callback: (event: unknown) => void) => () => void
    onTranslationProgress: (callback: (event: unknown) => void) => () => void
    onTranslationDone: (callback: (event: unknown) => void) => () => void
    onTranslationError: (callback: (event: unknown) => void) => () => void
  }
}
