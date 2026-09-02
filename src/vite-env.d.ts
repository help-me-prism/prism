/// <reference types="vite/client" />

type ProviderId = 'codex' | 'claude'
type ProviderModel = { id: string; name: string; description: string }
type ProviderInfo = { id: ProviderId; name: string; available: boolean; status: string; models: ProviderModel[] }
type ContextAnchor = { paperId: string; paperTitle: string; anchorId: string; type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string; source: string; preview?: string; placementId?: string; textOffset?: number }
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number; anchors?: ContextAnchor[] }
type ChatSession = { id: string; title: string; provider: ProviderId; model: string; providerThreadId?: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; deletedAt?: number }
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type AppSettings = { libraryPath?: string; translationProvider: ProviderId; translationModel: string; autoTranslate: boolean }
type ArxivPaper = { arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string; categories: string[]; pdfUrl: string; absUrl: string; citationCount?: number }
type PaperRecord = ArxivPaper & { pdfPath: string; notePath: string; translationPath: string; sourcePath?: string; downloadedAt: number }
type PaperFigureAsset = { id: string; order: number; caption?: string; sourcePath?: string; mimeType?: string; dataUrl?: string }
type LatexBlock = { id: string; kind: 'heading' | 'paragraph' | 'caption' | 'equation' | 'figure' | 'table'; source: string; section?: string }
type LatexStructure = { version: 3; rootFile: string; generatedAt: string; blocks: LatexBlock[] }
type TranslationSegment = { id: string; page: number; source: string; kind: 'text' | 'heading' | 'caption' | 'equation' | 'table' | 'artifact'; itemIndexes?: number[]; itemSlices?: Array<{ itemIndex: number; start: number; end: number }>; translation?: string; sourceMode?: 'latex' | 'pdf'; blockId?: string; sectionTitle?: string; paragraphContext?: string }
type TranslationCache = { version: number; provider: ProviderId; model: string; sourceHash: string; segments: TranslationSegment[] }
type WorkspaceCommand = { id: number; type: 'search' | 'choose-folder' | 'open-paper' | 'navigate-anchor'; paperId?: string; anchor?: ContextAnchor }
type WorkspaceSnapshot = { library: PaperRecord[]; openPaperIds: string[]; activePaperId?: string; libraryPath?: string }
type NoteSnapshot = { content: string; revision: string; modifiedAt: number }
type NoteSaveRequest = { content: string; expectedRevision?: string; force?: boolean }
type NoteSaveResult = { saved: true; snapshot: NoteSnapshot } | { saved: false; conflict: NoteSnapshot }
type KnowledgeNodeType = 'paper' | 'concept' | 'claim' | 'insight' | 'question'
type TemplateRecord = { id: string; name: string; nodeType: KnowledgeNodeType; content: string; revision: string; modifiedAt: number; isDefault: boolean }
type TemplateSaveRequest = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; expectedRevision?: string }
type TemplateSaveResult = { saved: true; templates: TemplateRecord[]; id: string } | { saved: false }
type KnowledgeStatus = 'inbox' | 'developing' | 'established' | 'archived'
type KnowledgeLevel = 'low' | 'medium' | 'high'
type KnowledgeNodeRecord = { id: string; title: string; nodeType: KnowledgeNodeType; status: KnowledgeStatus; importance: KnowledgeLevel; confidence: KnowledgeLevel; templateId?: string; relativePath: string; revision: string; modifiedAt: number }
type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string }
type KnowledgePropertyPatch = { status?: KnowledgeStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel }
type EvidenceAnchorRef = { paperId: string; anchorId: string; type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string }
type EvidenceAnchor = EvidenceAnchorRef & { paperTitle: string; source: string; sourceHash: string; availability: 'linked' | 'needs-relink' }

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
    readPaperNote: (arxivId: string) => Promise<NoteSnapshot>
    savePaperNote: (arxivId: string, request: NoteSaveRequest) => Promise<NoteSaveResult>
    listTemplates: () => Promise<TemplateRecord[]>
    saveTemplate: (request: TemplateSaveRequest) => Promise<TemplateSaveResult>
    deleteTemplate: (id: string) => Promise<TemplateRecord[]>
    setDefaultTemplate: (nodeType: KnowledgeNodeType, id: string) => Promise<TemplateRecord[]>
    listKnowledgeNodes: () => Promise<KnowledgeNodeRecord[]>
    createKnowledgeNode: (request: KnowledgeCreateRequest) => Promise<{ nodes: KnowledgeNodeRecord[]; id: string }>
    readKnowledgeNode: (id: string) => Promise<NoteSnapshot>
    saveKnowledgeNode: (id: string, request: NoteSaveRequest) => Promise<NoteSaveResult>
    updateKnowledgeProperties: (id: string, patch: KnowledgePropertyPatch, expectedRevision: string) => Promise<NoteSaveResult>
    deleteKnowledgeNode: (id: string) => Promise<KnowledgeNodeRecord[]>
    listEvidenceAnchors: () => Promise<EvidenceAnchor[]>
    openEvidenceAnchor: (anchor: EvidenceAnchorRef) => Promise<boolean>
    onOpenEvidenceAnchor: (callback: (anchor: EvidenceAnchorRef) => void) => () => void
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
