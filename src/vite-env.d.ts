/// <reference types="vite/client" />

type ProviderId = 'codex' | 'claude'
type ProviderModel = { id: string; name: string; description: string }
type ProviderInfo = { id: ProviderId; name: string; available: boolean; status: string; models: ProviderModel[] }
type ContextAnchor = { paperId: string; paperTitle: string; anchorId: string; type: 'sentence' | 'section' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string; source: string; preview?: string; placementId?: string; textOffset?: number }
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number; anchors?: ContextAnchor[] }
type ChatSession = { id: string; title: string; provider: ProviderId; model: string; providerThreadId?: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; deletedAt?: number }
type ChatRequest = { prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type AppSettings = { libraryPath?: string; translationProvider: ProviderId; translationModel: string; autoTranslate: boolean; knowledgeProvider?: ProviderId; knowledgeModel?: string }
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
type NoteSaveRequest = { content: string; expectedRevision?: string; force?: boolean; createStubs?: boolean }
type NoteSaveResult = { saved: true; snapshot: NoteSnapshot; stubs?: string[] } | { saved: false; conflict: NoteSnapshot }
type PaperCaptureRequest =
  | { kind: 'evidence'; paperId: string; anchorId: string; memo?: string; concept?: string }
  | { kind: 'chat'; paperId: string; question: string; answer: string; provider: string; model: string; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number }> }
type PaperCaptureResult = { saved: true; snapshot: NoteSnapshot; blockId?: string; concept?: string }
type CurationMemo = { paper: KnowledgeNodeRecord; blockId: string; anchorLabel: string; anchorSource: string; anchor?: EvidenceAnchorRef; memo: string; aiHint?: { id: string; kind: 'claim' | 'question'; why: string } }
type CurationStub = { node: KnowledgeNodeRecord; backlinks: number; ready: boolean }
type CurationPendingRelation = { relation: KnowledgeRelationRecord; source: KnowledgeNodeRecord; target: KnowledgeNodeRecord }
type CurationConceptSuggestion = { id: string; title: string; reason: string; status: 'pending' | 'accepted' | 'rejected'; paperNodeId: string; paperTitle: string }
type ModelSuggestionSummary = { paperNodeId: string; paperTitle: string; provider: string; model: string; ranAt: string; relationsCreated: number; relationsSkipped: number; candidates: number; concepts: number }
type ModelSuggestionReview = { paperNodeId: string; id: string; decision: 'accepted' | 'rejected' }
type CurationQueue = { pendingRelations: CurationPendingRelation[]; stubs: CurationStub[]; memos: CurationMemo[]; unsupportedClaims: KnowledgeNodeRecord[]; unansweredQuestions: KnowledgeNodeRecord[]; conceptSuggestions: CurationConceptSuggestion[]; modelRuns: ModelSuggestionSummary[]; total: number }
type PromoteMemoRequest = { paperNodeId: string; blockId: string; memo: string; nodeType: 'claim' | 'question'; title: string }
type CitationEntry = { arxivId?: string; title: string; year?: number; citationCount?: number; authors: string[]; inLibrary: boolean; nodeId?: string }
type CitationLinks = { arxivId: string; fetchedAt: string; references: CitationEntry[]; citations: CitationEntry[]; stale: boolean; error?: string }
type MergeConceptsRequest = { sourceId: string; targetId: string }
type KnowledgeNodeType = 'paper' | 'concept' | 'claim' | 'insight' | 'question' | 'project'
type TemplateRecord = { id: string; name: string; nodeType: KnowledgeNodeType; content: string; revision: string; modifiedAt: number; isDefault: boolean; isFavorite: boolean; lastUsedAt?: number }
type TemplateSaveRequest = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; expectedRevision?: string }
type TemplateSaveResult = { saved: true; templates: TemplateRecord[]; id: string } | { saved: false }
type KnowledgeStatus = 'inbox' | 'developing' | 'established' | 'archived'
type KnowledgeReadingStatus = 'to_read' | 'reading' | 'read' | 'paused'
type KnowledgeLevel = 'low' | 'medium' | 'high'
type ClaimOrigin = 'paper' | 'mine'
type EvidenceKind = 'theory' | 'experiment' | 'anecdote' | 'idea'
type KnowledgeNodeRecord = { id: string; title: string; nodeType: KnowledgeNodeType; status: KnowledgeStatus; readingStatus?: KnowledgeReadingStatus; importance: KnowledgeLevel; confidence: KnowledgeLevel; templateId?: string; arxivId?: string; claimOrigin?: ClaimOrigin; evidenceKind?: EvidenceKind; scopeDomain?: string; scopeRegime?: string; scopeAssumptions?: string[]; projects?: string[]; preview: string; evidenceCount: number; relativePath: string; revision: string; modifiedAt: number }
type KnowledgeSearchResult = { node: KnowledgeNodeRecord; excerpt: string; score: number }
type ResearchSearchResult = KnowledgeSearchResult & { textScore: number; semanticScore: number }
type ResearchEvidence = { nodeId: string; paperId: string; anchorId: string; type: EvidenceAnchorRef['type']; page: number; label: string; paperTitle: string; source: string }
type ResearchContext = { query: string; seeds: ResearchSearchResult[]; nodes: KnowledgeNodeRecord[]; relations: KnowledgeRelationRecord[]; evidence: ResearchEvidence[] }
type ResearchIndexStatus = { nodeCount: number; signature: string; rebuilt: boolean; relativePath: '.prism/index/research-search-v1.json' }
type KnowledgeSuggestion = { id: string; kind: 'duplicate_concept' | 'supports' | 'contradicts' | 'evidence_gap' | 'research_gap'; source: KnowledgeNodeRecord; target?: KnowledgeNodeRecord; proposedRelation?: KnowledgeRelationType; confidence: number; reason: string }
type ProjectKnowledgeContext = { project: KnowledgeNodeRecord; concepts: KnowledgeNodeRecord[]; insights: KnowledgeNodeRecord[] }
type ConflictingPaperPair = { relationId: string; left: KnowledgeNodeRecord; right: KnowledgeNodeRecord }
type KnowledgeDataViews = { projects: KnowledgeNodeRecord[]; unansweredQuestions: KnowledgeNodeRecord[]; unsupportedClaims: KnowledgeNodeRecord[]; projectContexts: ProjectKnowledgeContext[]; conflictingPapers: ConflictingPaperPair[] }
type ObsidianOpenRequest = { nodeId: string; heading?: string; blockId?: string }
type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string; variables?: Record<string, string>; status?: KnowledgeStatus }
type ApplyTemplateSectionsResult = { saved: true; snapshot: NoteSnapshot; addedHeadings: string[] } | { saved: false; conflict: NoteSnapshot }
type KnowledgePropertyPatch = { status?: KnowledgeStatus; readingStatus?: KnowledgeReadingStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel; claimOrigin?: ClaimOrigin; evidenceKind?: EvidenceKind | ''; scopeDomain?: string; scopeRegime?: string; scopeAssumptions?: string[]; projects?: string[] }
type KnowledgeBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
type KnowledgeRelationType = 'defines' | 'uses' | 'supports' | 'contradicts' | 'extends' | 'raises' | 'answers' | 'mentions' | 'discusses' | 'presents' | 'explains' | 'evidence_for' | 'derived_from' | 'related'
type RelationEvidenceAnchor = EvidenceAnchorRef
type KnowledgeRelationRecord = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected'; evidenceAnchor?: RelationEvidenceAnchor; createdAt: string }
type KnowledgeRelationView = KnowledgeRelationRecord & { direction: 'outgoing' | 'incoming'; other: Pick<KnowledgeNodeRecord, 'id' | 'title' | 'nodeType' | 'relativePath'> }
type KnowledgeRelationCreateRequest = { sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; evidenceAnchor?: RelationEvidenceAnchor; expectedRevision: string }
type KnowledgeRelationUpdateRequest = { id: string; type: KnowledgeRelationType; evidenceAnchor?: RelationEvidenceAnchor | null; expectedRevision: string }
type KnowledgeRelationDeleteRequest = { id: string; expectedRevision: string }
type KnowledgeRelationReviewRequest = { id: string; decision: 'approved' | 'rejected'; expectedRevision: string }
type KnowledgeRelationMutationResult = { saved: true; relation?: KnowledgeRelationRecord; snapshot: NoteSnapshot; relations: KnowledgeRelationView[] } | { saved: false; conflict: NoteSnapshot }
type EvidenceAnchorRef = { paperId: string; anchorId: string; type: 'sentence' | 'section' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string }
type EvidenceAnchor = EvidenceAnchorRef & { paperTitle: string; source: string; sourceHash: string; availability: 'linked' | 'needs-relink' }
type EvidenceBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
type KnowledgeEvidenceCopyRequest = { sourceNodeId: string; targetNodeId: string; blockId: string; expectedTargetRevision: string }

type ProviderAuthEvent = { provider: ProviderId; text: string }

interface Window {
  prism: {
    listProviders: () => Promise<ProviderInfo[]>
    loginProvider: (provider: ProviderId) => Promise<{ success: boolean; message: string }>
    logoutProvider: (provider: ProviderId) => Promise<{ success: boolean; message: string }>
    onProviderAuthData: (callback: (event: ProviderAuthEvent) => void) => () => void
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
    openPaperInReader: (arxivId?: string) => Promise<boolean>
    onOpenPaperInReader: (callback: (arxivId: string) => void) => () => void
    readPaperNote: (arxivId: string) => Promise<NoteSnapshot>
    savePaperNote: (arxivId: string, request: NoteSaveRequest) => Promise<NoteSaveResult>
    capturePaperNote: (request: PaperCaptureRequest) => Promise<PaperCaptureResult>
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
    listCurationQueue: () => Promise<CurationQueue>
    ensureLinkStubs: (id: string) => Promise<string[]>
    listPaperCitations: (arxivId: string, options?: { refresh?: boolean }) => Promise<CitationLinks>
    runModelSuggestions: (paperNodeId: string) => Promise<ModelSuggestionSummary>
    reviewModelSuggestion: (request: ModelSuggestionReview) => Promise<boolean>
    promoteMemo: (request: PromoteMemoRequest) => Promise<{ id: string }>
    mergeConcepts: (request: MergeConceptsRequest) => Promise<{ id: string }>
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
    updateKnowledgeRelation: (request: KnowledgeRelationUpdateRequest) => Promise<KnowledgeRelationMutationResult>
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
