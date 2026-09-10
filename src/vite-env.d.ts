/// <reference types="vite/client" />

type ProviderId = 'codex' | 'claude'
type ProviderModel = { id: string; name: string; description: string }
type ProviderInfo = { id: ProviderId; name: string; installed: boolean; available: boolean; status: string; models: ProviderModel[] }
type ContextAnchor = { scientificSpans?: import('../electron/scientificSource').ScientificSpan[]; paperId: string; paperTitle: string; anchorId: string; type: 'sentence' | 'section' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string; source: string; preview?: string; placementId?: string; textOffset?: number }
type ChatMessage = { id: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt: number; anchors?: ContextAnchor[]; paperIds?: string[]; primaryPaperId?: string; provider?: ProviderId; model?: string }
type PaperDigestResult = { updated: boolean; chatMessages: number; sections: Array<'overview' | 'confusion' | 'focus'>; usedModel: boolean }
// 컨텍스트 점유량은 "직전 요청이 실제로 보낸 대화 전체" 다. 턴마다 쌓이는 누적 토큰과는 다른 값이라
// 누적치로 계산하면 대화가 길어질수록 잔량을 과대하게 깎아 보여준다.
type ChatContextUsage = { usedTokens: number; contextWindow: number }
type ChatUsage = { context?: ChatContextUsage }
// Codex 는 초기화 시각을 epoch 로 주고 Claude 는 "Sep 12 at 6am" 같은 문장으로 준다.
// 계산해서 보여줄 수 있으면 resetsAt 을, 아니면 받은 문장을 그대로 쓴다.
type ProviderRateLimitWindow = { label?: string; usedPercent: number; windowDurationMins?: number; resetsAt?: number; resetsText?: string }
type ProviderRateLimits = { primary?: ProviderRateLimitWindow; secondary?: ProviderRateLimitWindow }
type ChatSession = { libraryPath?: string | null; id: string; title: string; provider: ProviderId; model: string; providerThreadId?: string; messages: ChatMessage[]; createdAt: number; updatedAt: number; deletedAt?: number; usage?: ChatUsage }
type ChatRequest = { libraryPath: string | null; figures?: Array<{ paperId: string; anchorId: string; label: string }>; prompt: string; sessionId: string; messageId: string; provider: ProviderId; model: string; providerThreadId?: string }
type AppSettings = { libraryPath?: string; paperStoragePath?: string; translationProvider: ProviderId; translationModel: string; autoTranslate: boolean; knowledgeProvider?: ProviderId; knowledgeModel?: string }
type ArxivPaper = { arxivId: string; title: string; authors: string[]; summary: string; published: string; updated: string; categories: string[]; pdfUrl: string; absUrl: string; citationCount?: number }
type PaperRecord = ArxivPaper & { pdfPath: string; notePath: string; translationPath: string; sourcePath?: string; downloadedAt: number; externalAssets?: boolean }
type PaperFigureAsset = { id: string; order: number; caption?: string; sourcePath?: string; mimeType?: string; dataUrl?: string }
type LatexBlock = { id: string; kind: 'heading' | 'paragraph' | 'caption' | 'equation' | 'figure' | 'table'; source: string; section?: string }
type LatexStructure = { version: 3; rootFile: string; generatedAt: string; blocks: LatexBlock[] }
type TranslationSegment = { scientificSpans?: import('./../electron/scientificSource').ScientificSpan[]; sourceFontWeight?: 400 | 700; preciseRects?: Array<{ left: number; top: number; width: number; height: number; fontSize: number }>; id: string; page: number; source: string; kind: 'text' | 'heading' | 'caption' | 'equation' | 'table' | 'artifact'; itemIndexes?: number[]; itemSlices?: Array<{ itemIndex: number; start: number; end: number }>; translation?: string; sourceMode?: 'latex' | 'pdf'; blockId?: string; sectionTitle?: string; paragraphContext?: string }
type TranslationCache = { version: number; provider: ProviderId; model: string; sourceHash: string; segments: TranslationSegment[] }
type WorkspaceCommand = { id: number; type: 'search' | 'choose-folder' | 'open-paper' | 'navigate-anchor' | 'memo-anchor'; paperId?: string; anchor?: ContextAnchor }
type WorkspaceSnapshot = { library: PaperRecord[]; openPaperIds: string[]; activePaperId?: string; libraryPath?: string }
type ReadingSizeSnapshot = { paperId: string; mode: 'original' | 'translated'; scale: number; anchorId: string; page: number }
type ReadingSizeRequest = ReadingSizeSnapshot & { id: number }
type NoteSnapshot = { vaultId?: string; content: string; revision: string; modifiedAt: number }
type NoteSaveRequest = { vaultId?: string; content: string; expectedRevision?: string; force?: boolean; createStubs?: boolean }
type NoteSaveResult = { saved: true; snapshot: NoteSnapshot; stubs?: string[] } | { saved: false; conflict: NoteSnapshot }
type PaperCaptureRequest =
  | { kind: 'evidence'; libraryPath?: string; paperId: string; anchorId: string; memo?: string; concept?: string }
  | { kind: 'chat'; libraryPath: string; paperId: string; question: string; answer: string; provider: string; model: string; anchors?: Array<{ paperId: string; anchorId: string; label: string; page?: number }> }
type PaperCaptureResult = { saved: true; snapshot: NoteSnapshot; blockId?: string; concept?: string; warning?: string }
type CurationMemo = { paper: KnowledgeNodeRecord; blockId: string; anchorLabel: string; anchorSource: string; anchor?: EvidenceAnchorRef; memo: string; aiHint?: { id: string; kind: 'claim' | 'question'; why: string } }
type CurationStub = { node: KnowledgeNodeRecord; backlinks: number; ready: boolean }
type CurationPendingRelation = { relation: KnowledgeRelationRecord; source: KnowledgeNodeRecord; target: KnowledgeNodeRecord }
type ModelClaimSuggestion = { id: string; sentence: string; why: string; status: 'pending' | 'accepted' | 'rejected' }
type CurationClaimSuggestion = ModelClaimSuggestion & { paperNodeId: string; paperTitle: string }
type CurationConceptSuggestion = { id: string; title: string; reason: string; status: 'pending' | 'accepted' | 'rejected'; paperNodeId: string; paperTitle: string }
type ModelSuggestionSummary = { paperNodeId: string; paperTitle: string; provider: string; model: string; ranAt: string; relationsCreated: number; relationsSkipped: number; candidates: number; concepts: number; claims: number }
type ModelSuggestionReview = { paperNodeId: string; id: string; decision: 'accepted' | 'rejected' }
type CurationApplyNote = { node: KnowledgeNodeRecord; line: string }
type PromoteApplyRequest = { nodeId: string; line: string; title: string }
type CurationConflict = { relationId: string; left: KnowledgeNodeRecord; right: KnowledgeNodeRecord; claim?: KnowledgeNodeRecord }
type CurationQueue = { pendingRelations: CurationPendingRelation[]; stubs: CurationStub[]; memos: CurationMemo[]; applyNotes: CurationApplyNote[]; unsupportedClaims: KnowledgeNodeRecord[]; unansweredQuestions: KnowledgeNodeRecord[]; conflicts: CurationConflict[]; conceptSuggestions: CurationConceptSuggestion[]; claimSuggestions: CurationClaimSuggestion[]; modelRuns: ModelSuggestionSummary[]; total: number }
type PromoteMemoRequest = { paperNodeId: string; blockId: string; memo: string; nodeType: 'claim' | 'question'; title: string }
type CitationEntry = { arxivId?: string; doi?: string; title: string; year?: number; citationCount?: number; authors: string[]; inLibrary: boolean; nodeId?: string }
type CitationLinks = { arxivId: string; fetchedAt: string; references: CitationEntry[]; citations: CitationEntry[]; stale: boolean; error?: string }
type MergeConceptsRequest = { sourceId: string; targetId: string }
type StructureRole = 'problem' | 'background' | 'method' | 'component' | 'rationale' | 'experiment' | 'result' | 'limit'
type StructureEdgeType = 'then' | 'part' | 'needs' | 'supports' | 'branches' | 'contrasts'
type StructureOrigin = 'outline' | 'model'
type StructureNode = { id: string; role: StructureRole; label: string; labelKo?: string; section: string; level: number; page: number; anchorId: string; evidence: string[]; summary?: string; roleOrigin: StructureOrigin }
type StructureEdge = { id: string; from: string; to: string; type: StructureEdgeType; origin: StructureOrigin; why?: string }
type StructureRunSummary = { paperId: string; provider: string; model: string; ranAt: string; sections: number; rolesChanged: number; summaries: number; edgesAdded: number; dropped: number; notes: string[] }
type PaperStructure = { version: 1; paperId: string; generatedAt: string; source: StructureOrigin; sourceHash: string; nodes: StructureNode[]; edges: StructureEdge[]; notes: string[]; model?: { provider: string; model: string; ranAt: string } }
type KnowledgeNodeType = 'paper' | 'concept' | 'claim' | 'insight' | 'question' | 'project'
type TemplateRecord = { id: string; name: string; nodeType: KnowledgeNodeType; content: string; revision: string; modifiedAt: number; isDefault: boolean; isFavorite: boolean; lastUsedAt?: number }
type TemplateSaveRequest = { id?: string; name: string; nodeType: KnowledgeNodeType; content: string; expectedRevision?: string }
type TemplateSaveResult = { saved: true; templates: TemplateRecord[]; id: string } | { saved: false }
type KnowledgeStatus = 'inbox' | 'developing' | 'understood' | 'established' | 'archived'
type KnowledgeReadingStatus = 'to_read' | 'reading' | 'read' | 'paused'
type KnowledgeLevel = 'low' | 'medium' | 'high'
type ClaimOrigin = 'paper' | 'mine'
type EvidenceKind = 'theory' | 'experiment' | 'anecdote' | 'idea'
type KnowledgeNodeRecord = { id: string; title: string; aliases?: string[]; nodeType: KnowledgeNodeType; status: KnowledgeStatus; readingStatus?: KnowledgeReadingStatus; importance: KnowledgeLevel; confidence: KnowledgeLevel; templateId?: string; arxivId?: string; claimOrigin?: ClaimOrigin; evidenceKind?: EvidenceKind; scopeDomain?: string; scopeRegime?: string; scopeAssumptions?: string[]; projects?: string[]; preview: string; evidenceCount: number; relativePath: string; revision: string; modifiedAt: number }
type ResearchSearchResult = KnowledgeSearchResult & { textScore: number; semanticScore: number }
type KnowledgeSuggestion = { id: string; kind: 'duplicate_concept' | 'supports' | 'contradicts' | 'evidence_gap' | 'research_gap'; source: KnowledgeNodeRecord; target?: KnowledgeNodeRecord; proposedRelation?: KnowledgeRelationType; confidence: number; reason: string }
type ObsidianOpenRequest = { nodeId: string; heading?: string; blockId?: string }
type KnowledgeCreateRequest = { title: string; nodeType: KnowledgeNodeType; templateId?: string; variables?: Record<string, string>; status?: KnowledgeStatus; body?: string; vaultId?: string }
type ApplyTemplateSectionsResult = { saved: true; snapshot: NoteSnapshot; addedHeadings: string[] } | { saved: false; conflict: NoteSnapshot }
type KnowledgePropertyPatch = { status?: KnowledgeStatus; readingStatus?: KnowledgeReadingStatus; importance?: KnowledgeLevel; confidence?: KnowledgeLevel; claimOrigin?: ClaimOrigin; evidenceKind?: EvidenceKind | ''; scopeDomain?: string; scopeRegime?: string; scopeAssumptions?: string[]; projects?: string[] }
type KnowledgeBacklink = { nodeId: string; title: string; nodeType: KnowledgeNodeType; relativePath: string; excerpt: string }
type KnowledgeRelationType = 'defines' | 'uses' | 'supports' | 'contradicts' | 'extends' | 'raises' | 'answers' | 'link' | 'mentions' | 'discusses' | 'presents' | 'explains' | 'evidence_for' | 'derived_from' | 'related'
type RelationEvidenceAnchor = EvidenceAnchorRef
type RelationOrigin = 'manual' | 'link'
type KnowledgeRelationRecord = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected'; evidenceAnchor?: RelationEvidenceAnchor; origin?: RelationOrigin; createdAt: string }
type KnowledgeRelationView = KnowledgeRelationRecord & { direction: 'outgoing' | 'incoming'; other: Pick<KnowledgeNodeRecord, 'id' | 'title' | 'nodeType' | 'relativePath'> }
type KnowledgeRelationCreateRequest = { sourceId: string; targetId: string; type: KnowledgeRelationType; creator: 'user' | 'ai'; evidenceAnchor?: RelationEvidenceAnchor; expectedRevision: string; vaultId?: string }
type KnowledgeRelationDeleteRequest = { id: string; expectedRevision: string }
type KnowledgeRelationReviewRequest = { id: string; decision: 'approved' | 'rejected'; expectedRevision: string }
type KnowledgeGraphNode = { id: string; title: string; nodeType: KnowledgeNodeType; status: KnowledgeStatus; relativePath: string; modifiedAt: number }
type KnowledgeGraphEdge = { id: string; sourceId: string; targetId: string; type: KnowledgeRelationType; origin: RelationOrigin; creator: 'user' | 'ai'; reviewStatus: 'pending' | 'approved' | 'rejected' }
type KnowledgeGraph = { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[]; generatedAt: string }
type SimilarPair = { a: string; b: string; score: number; shared: string[] }
type SimilarityReport = { pairs: SimilarPair[]; measured: number; compared: number; threshold: number; median: number; deviation: number; thin: string[] }
type KnowledgeCluster = { id: string; name: string; nameId: string; members: string[]; inside: number; crossing: number }
type ClusterReport = { clusters: KnowledgeCluster[]; modularity: number; clear: boolean; loose: string[] }
type KnowledgeGraphInsights = { clusters: ClusterReport; similar: SimilarityReport }
type KnowledgeRelationMutationResult = { saved: true; relation?: KnowledgeRelationRecord; snapshot: NoteSnapshot; relations: KnowledgeRelationView[] } | { saved: false; conflict: NoteSnapshot }
type EvidenceAnchorRef = { paperId: string; anchorId: string; type: 'sentence' | 'section' | 'equation' | 'table' | 'figure' | 'page'; page: number; label: string }
type EvidenceAnchor = EvidenceAnchorRef & { scientificSpans?: import('../electron/scientificSource').ScientificSpan[]; paperTitle: string; source: string; sourceHash: string; availability: 'linked' | 'needs-relink' }
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
    onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void
    getSettings: () => Promise<AppSettings>
    updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
    reconnectPaperStorage: () => Promise<{ restored: number; skipped: number; noteWarnings: number } | null>
    onLibraryChanged: (callback: (records: PaperRecord[]) => void) => () => void
    choosePaperStorage: (reset?: boolean) => Promise<AppSettings | null>
    chooseWorkspace: () => Promise<AppSettings | null>
    listLibrary: () => Promise<PaperRecord[]>
    updatePaperTitle: (input: { paperId: string; title: string; expectedTitle: string; libraryPath: string }) => Promise<{ paper: PaperRecord; warnings: string[] }>
    searchCrossref: (query: string) => Promise<ArxivPaper[]>
    openDoi: (id: string) => Promise<void>
    searchArxiv: (input: string) => Promise<ArxivPaper[]>
    autocompletePapers: (input: string) => Promise<Array<{ title: string; authorsYear?: string }>>
    openArxiv: (arxivId: string) => Promise<void>
    importLocalPaper: (metadata?: ArxivPaper) => Promise<PaperRecord | null>
    downloadPaper: (paper: ArxivPaper) => Promise<PaperRecord>
    readPaperPdf: (arxivId: string) => Promise<Uint8Array>
    readLatexStructure: (arxivId: string) => Promise<LatexStructure | null>
    readPaperFigures: (arxivId: string) => Promise<PaperFigureAsset[]>
    openNotes: () => Promise<boolean>
    setAppearance: (theme: 'light' | 'dark') => Promise<void>
    openPaperInReader: (arxivId?: string) => Promise<boolean>
    onOpenPaperInReader: (callback: (arxivId: string) => void) => () => void
    capturePaperNote: (request: PaperCaptureRequest) => Promise<PaperCaptureResult>
    listTemplates: () => Promise<TemplateRecord[]>
    saveTemplate: (request: TemplateSaveRequest) => Promise<TemplateSaveResult>
    deleteTemplate: (id: string) => Promise<TemplateRecord[]>
    setDefaultTemplate: (nodeType: KnowledgeNodeType, id: string) => Promise<TemplateRecord[]>
    setFavoriteTemplate: (id: string, favorite: boolean) => Promise<TemplateRecord[]>
    listKnowledgeNodes: () => Promise<KnowledgeNodeRecord[]>
    searchResearchKnowledge: (query: string) => Promise<ResearchSearchResult[]>
    suggestKnowledge: (nodeId: string) => Promise<KnowledgeSuggestion[]>
    listCurationQueue: () => Promise<CurationQueue>
    syncNoteLinks: (id: string) => Promise<{ stubs: string[]; added: number; removed: number }>
    pruneEmptySections: (id: string) => Promise<{ removed: string[] }>
    listAutoUnread: () => Promise<Record<string, { at: number; sections: string[] }>>
    clearAutoUnread: (id: string) => Promise<{ cleared: boolean }>
    refreshPaperDigest: (paperNodeId: string, options?: { useModel?: boolean }) => Promise<PaperDigestResult>
    refreshVaultDigests: () => Promise<{ scanned: number; updated: string[]; understood: string[] }>
    onVaultChanged: (callback: (event: { paths: string[] }) => void) => () => void
    restoreKnowledgeNode: (trashedRelativePath: string) => Promise<{ nodes: KnowledgeNodeRecord[]; id: string }>
    listPaperCitations: (arxivId: string, options?: { refresh?: boolean }) => Promise<CitationLinks>
    readPaperStructure: (arxivId: string) => Promise<PaperStructure>
    refinePaperStructure: (arxivId: string) => Promise<StructureRunSummary>
    runModelSuggestions: (paperNodeId: string) => Promise<ModelSuggestionSummary>
    reviewModelSuggestion: (request: ModelSuggestionReview) => Promise<boolean>
    promoteMemo: (request: PromoteMemoRequest) => Promise<{ id: string }>
    promoteApplyNote: (request: PromoteApplyRequest) => Promise<{ id: string }>
    mergeConcepts: (request: MergeConceptsRequest) => Promise<{ id: string }>
    openKnowledgeNodeInObsidian: (request: ObsidianOpenRequest) => Promise<boolean>
    createKnowledgeNode: (request: KnowledgeCreateRequest) => Promise<{ nodes: KnowledgeNodeRecord[]; id: string }>
    applyTemplateSections: (request: { nodeId: string; templateId: string; expectedRevision: string }) => Promise<ApplyTemplateSectionsResult>
    readKnowledgeNode: (id: string, vaultId?: string) => Promise<NoteSnapshot>
    listPendingNoteRecoveries: () => Promise<Array<{ id: string; noteFile: string; relativePath: string; createdAt: number; kinds: Array<'draft' | 'before' | 'displaced'> }>>
    readPendingNoteRecovery: (id: string, kind: 'draft' | 'before' | 'displaced') => Promise<string>
    recoverPendingNote: (id: string, kind: 'draft' | 'before' | 'displaced') => Promise<void>
    listNoteHistory: (id: string, vaultId?: string) => Promise<Array<{ id: string; createdAt: number; kind: 'before' | 'draft' | 'displaced'; size: number }>>
    readNoteHistory: (id: string, entryId: string, vaultId?: string) => Promise<string>
    saveKnowledgeNode: (id: string, request: NoteSaveRequest) => Promise<NoteSaveResult>
    updateKnowledgeProperties: (id: string, patch: KnowledgePropertyPatch, expectedRevision: string) => Promise<NoteSaveResult>
    deleteKnowledgeNode: (id: string) => Promise<{ nodes: KnowledgeNodeRecord[]; trashed: string; title: string }>
    listKnowledgeBacklinks: (id: string) => Promise<KnowledgeBacklink[]>
    copyKnowledgeEvidence: (request: KnowledgeEvidenceCopyRequest) => Promise<NoteSaveResult>
    listKnowledgeGraph: () => Promise<KnowledgeGraph>
    listKnowledgeGraphInsights: () => Promise<KnowledgeGraphInsights>
    listKnowledgeRelations: (id: string) => Promise<KnowledgeRelationView[]>
    createKnowledgeRelation: (request: KnowledgeRelationCreateRequest) => Promise<KnowledgeRelationMutationResult>
    deleteKnowledgeRelation: (request: KnowledgeRelationDeleteRequest) => Promise<KnowledgeRelationMutationResult>
    reviewKnowledgeRelation: (request: KnowledgeRelationReviewRequest) => Promise<KnowledgeRelationMutationResult>
    listEvidenceAnchors: () => Promise<EvidenceAnchor[]>
    openEvidenceAnchor: (anchor: EvidenceAnchorRef) => Promise<boolean>
    onOpenEvidenceAnchor: (callback: (anchor: EvidenceAnchorRef) => void) => () => void
    listEvidenceBacklinks: (anchor: EvidenceAnchorRef) => Promise<EvidenceBacklink[]>
    openKnowledgeNodeInNotes: (id: string, options?: { blockId?: string; libraryPath?: string }) => Promise<boolean>
    onOpenKnowledgeNode: (callback: (request: string | { id: string; blockId?: string; libraryPath?: string }) => void) => () => void
    readSavedFigure: (paperId: string, anchorId: string) => Promise<{ dataUrl: string; rect?: { x: number; y: number; width: number; height: number }; page?: number }>
    savePaperFigure: (arxivId: string, figureId: string, dataUrl: string, metadata: unknown) => Promise<string>
    readTranslation: (arxivId: string) => Promise<TranslationCache | null>
    savePaperAnchors: (arxivId: string, anchors: TranslationSegment[]) => Promise<boolean>
    startTranslation: (arxivId: string, segments: TranslationSegment[], options?: { force?: boolean; pages?: number[] }) => Promise<{ started: boolean }>
    cancelTranslation: (arxivId: string) => Promise<boolean>
    readAiUsage: () => Promise<import('../electron/aiUsageTypes').AiRun[]>
    sendMessage: (request: ChatRequest) => Promise<{ started: boolean }>
    cancelMessage: (sessionId: string) => Promise<boolean>
    onChatEvent: (callback: (event: unknown) => void) => () => void
    onChatDone: (callback: (event: unknown) => void) => () => void
    onChatError: (callback: (event: unknown) => void) => () => void
    onProviderRateLimits: (callback: (event: ProviderRateLimits & { provider: ProviderId }) => void) => () => void
    onTranslationProgress: (callback: (event: unknown) => void) => () => void
    onTranslationDone: (callback: (event: unknown) => void) => () => void
    onTranslationError: (callback: (event: unknown) => void) => () => void
  }
}
