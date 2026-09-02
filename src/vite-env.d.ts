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
type KnowledgeNodeType = 'paper' | 'concept' | 'claim' | 'insight' | 'question' | 'project'
type TemplateRecord = { id: string; name: string; nodeType: KnowledgeNodeType; content: string; revision: string; modifiedAt: number; isDefault: boolean; isFavorite: boolean; lastUsedAt?: number }
type TemplateSaveRequest = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; expectedRevision?: string }
type TemplateSaveResult = { saved: true; templates: TemplateRecord[]; id: string } | { saved: false }
type KnowledgeStatus = 'inbox' | 'developing' | 'established' | 'archived'
type KnowledgeLevel = 'low' | 'medium' | 'high'
type KnowledgeNodeRecord = { id: string; title: string; nodeType: KnowledgeNodeType; status: KnowledgeStatus; importance: KnowledgeLevel; confidence: KnowledgeLevel; templateId?: string; preview: string; evidenceCount: number; relativePath: string; revision: string; modifiedAt: number }
type KnowledgeSearchResult = { node: KnowledgeNodeRecord; excerpt: string; score: number }
type ResearchSearchResult = KnowledgeSearchResult & { textScore: number; semanticScore: number }
type ResearchEvidence = { nodeId: string; paperId: string; anchorId: string; type: EvidenceAnchorRef['type']; page: number; label: string; paperTitle: string; source: string }
type ResearchContext = { query: string; seeds: ResearchSearchResult[]; nodes: KnowledgeNodeRecord[]; relations: KnowledgeRelationRecord[]; evidence: ResearchEvidence[] }
type ResearchIndexStatus = { nodeCount: number; signature: string; rebuilt: boolean; relativePath: '.prism/index/research-search-v1.json' }
type KnowledgeSuggestion = { id: string; kind: 'duplicate_concept' | 'supports' | 'contradicts' | 'evidence_gap' | 'research_gap'; source: KnowledgeNodeRecord; target?: KnowledgeNodeRecord; proposedRelation?: KnowledgeRelationType; confidence: number; reason: string }
type KnowledgeDataViews = { projects: KnowledgeNodeRecord[]; unansweredQuestions: KnowledgeNodeRecord[]; unsupportedClaims: KnowledgeNodeRecord[] }
type ObsidianOpenRequest = { nodeId: string; heading?: string; blockId?: string }
type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string; variables?: Record<string, string> }
type ApplyTemplateSectionsResult = { saved: true; snapshot: NoteSnapshot; addedHeadings: string[] } | { saved: false; conflict: NoteSnapshot }
type KnowledgePropertyPatch = { status?: KnowledgeStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel }
type KnowledgeBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
type KnowledgeRelationType = 'discusses' | 'supports' | 'contradicts' | 'extends' | 'uses' | 'explains' | 'evidence_for' | 'derived_from' | 'raises' | 'related'
type RelationEvidenceAnchor = EvidenceAnchorRef
type KnowledgeRelationRecord = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected'; evidenceAnchor?: RelationEvidenceAnchor; createdAt: string }
type KnowledgeRelationView = KnowledgeRelationRecord & { direction: 'outgoing' | 'incoming'; other: Pick<KnowledgeNodeRecord, 'id' | 'title' | 'nodeType' | 'relativePath'> }
type KnowledgeRelationCreateRequest = { sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; evidenceAnchor?: RelationEvidenceAnchor; expectedRevision: string }
type KnowledgeRelationUpdateRequest = { id: string; type: KnowledgeRelationType; evidenceAnchor?: RelationEvidenceAnchor | null; expectedRevision: string }
type KnowledgeRelationDeleteRequest = { id: string; expectedRevision: string }
type KnowledgeRelationReviewRequest = { id: string; decision: 'approved' | 'rejected'; expectedRevision: string }
type KnowledgeRelationMutationResult = { saved: true; relation?: KnowledgeRelationRecord; snapshot: NoteSnapshot; relations: KnowledgeRelationView[] } | { saved: false; conflict: NoteSnapshot }
type EvidenceAnchorRef = { paperId: string; anchorId: string; type: 'sentence' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string }
type EvidenceAnchor = EvidenceAnchorRef & { paperTitle: string; source: string; sourceHash: string; availability: 'linked' | 'needs-relink' }
type EvidenceBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
type KnowledgeEvidenceCopyRequest = { sourceNodeId: string; targetNodeId: string; blockId: string; expectedTargetRevision: string }

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
    setFavoriteTemplate: (id: string, favorite: boolean) => Promise<TemplateRecord[]>
    listKnowledgeNodes: () => Promise<KnowledgeNodeRecord[]>
    searchKnowledge: (query: string) => Promise<KnowledgeSearchResult[]>
    searchResearchKnowledge: (query: string) => Promise<ResearchSearchResult[]>
    retrieveResearchContext: (query: string) => Promise<ResearchContext>
    rebuildResearchIndex: () => Promise<ResearchIndexStatus>
    suggestKnowledge: (nodeId: string) => Promise<KnowledgeSuggestion[]>
    listKnowledgeDataViews: () => Promise<KnowledgeDataViews>
    openKnowledgeNodeInObsidian: (request: ObsidianOpenRequest) => Promise<boolean>
    createKnowledgeNode: (request: KnowledgeCreateRequest) => Promise<{ nodes: KnowledgeNodeRecord[]; id: string }>
    applyTemplateSections: (request: { nodeId: string; templateId: string; expectedRevision: string }) => Promise<ApplyTemplateSectionsResult>
    readKnowledgeNode: (id: string) => Promise<NoteSnapshot>
    saveKnowledgeNode: (id: string, request: NoteSaveRequest) => Promise<NoteSaveResult>
    updateKnowledgeProperties: (id: string, patch: KnowledgePropertyPatch, expectedRevision: string) => Promise<NoteSaveResult>
    deleteKnowledgeNode: (id: string) => Promise<KnowledgeNodeRecord[]>
    listKnowledgeBacklinks: (id: string) => Promise<KnowledgeBacklink[]>
    copyKnowledgeEvidence: (request: KnowledgeEvidenceCopyRequest) => Promise<NoteSaveResult>
    listKnowledgeRelations: (id: string) => Promise<KnowledgeRelationView[]>
    createKnowledgeRelation: (request: KnowledgeRelationCreateRequest) => Promise<KnowledgeRelationMutationResult>
    deleteKnowledgeRelation: (request: KnowledgeRelationDeleteRequest) => Promise<KnowledgeRelationMutationResult>
    reviewKnowledgeRelation: (request: KnowledgeRelationReviewRequest) => Promise<KnowledgeRelationMutationResult>
    listEvidenceAnchors: () => Promise<EvidenceAnchor[]>
    openEvidenceAnchor: (anchor: EvidenceAnchorRef) => Promise<boolean>
    onOpenEvidenceAnchor: (callback: (anchor: EvidenceAnchorRef) => void) => () => void
    listEvidenceBacklinks: (anchor: EvidenceAnchorRef) => Promise<EvidenceBacklink[]>
    openKnowledgeNodeInNotes: (id: string) => Promise<boolean>
    onOpenKnowledgeNode: (callback: (id: string) => void) => () => void
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
