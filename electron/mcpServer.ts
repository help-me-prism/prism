import process from 'node:process'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod/v4'
import { assertKnowledgeVault, mcpComparePapers, mcpCreateNoteDraft, mcpFindRelatedConcepts, mcpGetClaimEvidence, mcpOpenPaperAnchor, mcpSearchKnowledge, mcpSuggestRelationships } from './knowledgeMcp.js'

function vaultArgument() {
  const index = process.argv.indexOf('--vault'); const candidate = index >= 0 ? process.argv[index + 1] : process.env.PRISM_VAULT_PATH
  if (!candidate) throw new Error('Prism Vault 경로가 필요합니다. --vault <path> 또는 PRISM_VAULT_PATH를 설정하세요.')
  return candidate
}
function publicMessage(reason: unknown, libraryPath: string) {
  const message = reason instanceof Error ? reason.message : '알 수 없는 오류가 발생했습니다.'
  return message.replaceAll(libraryPath, '[Vault]').replaceAll(libraryPath.replaceAll('\\', '/'), '[Vault]')
}
function result(value: Record<string, unknown>) { return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value } }
function toolError(reason: unknown, libraryPath: string) { return { isError: true as const, content: [{ type: 'text' as const, text: publicMessage(reason, libraryPath) }] } }

function buildServer(libraryPath: string) {
  const server = new McpServer({ name: 'prism-research-knowledge', version: '0.1.0' }, { instructions: 'Search and inspect the local Prism research Vault. Distinguish PDF evidence, user notes, and derived suggestions. Never treat a suggestion as an approved relationship.' })
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
  server.registerTool('search_knowledge', { title: 'Search Prism knowledge', description: 'Hybrid text and local semantic search over Markdown knowledge nodes.', inputSchema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).optional() }), annotations: readOnly }, async ({ query, limit }) => { try { return result(await mcpSearchKnowledge(libraryPath, query, limit)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('get_claim_evidence', { title: 'Get Claim evidence', description: 'Return approved supporting or contradicting relations and exact PDF evidence for one Claim.', inputSchema: z.object({ claim_id: z.string().regex(/^[a-z]+-[a-f0-9-]{6,80}$/) }), annotations: readOnly }, async ({ claim_id }) => { try { return result(await mcpGetClaimEvidence(libraryPath, claim_id)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('find_related_concepts', { title: 'Find related Concepts', description: 'Return approved Concept relations and clearly labelled local semantic candidates.', inputSchema: z.object({ concept_id: z.string().regex(/^[a-z]+-[a-f0-9-]{6,80}$/) }), annotations: readOnly }, async ({ concept_id }) => { try { return result(await mcpFindRelatedConcepts(libraryPath, concept_id)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('compare_papers', { title: 'Compare Paper records', description: 'Return bounded Paper notes, evidence, and approved Claim or Concept links without generating a conclusion.', inputSchema: z.object({ paper_ids: z.array(z.string().regex(/^[a-z]+-[a-f0-9-]{6,80}$/)).min(2).max(8) }), annotations: readOnly }, async ({ paper_ids }) => { try { return result(await mcpComparePapers(libraryPath, paper_ids)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('open_paper_anchor', { title: 'Open a Paper anchor', description: 'Resolve a stable PDF anchor and queue it for a running Prism app.', inputSchema: z.object({ anchor_id: z.string().min(1).max(300), paper_id: z.string().regex(/^[a-zA-Z0-9._-]{1,160}$/).optional() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } }, async ({ anchor_id, paper_id }) => { try { return result(await mcpOpenPaperAnchor(libraryPath, anchor_id, paper_id)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('suggest_relationships', { title: 'Suggest knowledge relationships', description: 'Return deterministic, read-only relationship and research-gap suggestions for one active node.', inputSchema: z.object({ node_id: z.string().regex(/^[a-z]+-[a-f0-9-]{6,80}$/) }), annotations: readOnly }, async ({ node_id }) => { try { return result(await mcpSuggestRelationships(libraryPath, node_id)) } catch (reason) { return toolError(reason, libraryPath) } })
  server.registerTool('create_note_draft', { title: 'Create a Prism note draft', description: 'Create one non-overwriting AI draft from a user-owned Markdown template.', inputSchema: z.object({ template_id: z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/), title: z.string().min(1).max(200), variables: z.record(z.string(), z.string().max(2_000)).optional() }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } }, async ({ template_id, title, variables }) => { try { return result(await mcpCreateNoteDraft(libraryPath, template_id, title, variables)) } catch (reason) { return toolError(reason, libraryPath) } })
  return server
}

async function start() {
  const libraryPath = await assertKnowledgeVault(vaultArgument())
  serveStdio(() => buildServer(libraryPath), { onerror: (reason) => console.error(`Prism MCP protocol error: ${reason.message}`) })
  console.error('Prism research knowledge MCP server running on stdio.')
}

void start().catch((reason) => { console.error(reason instanceof Error ? reason.message : String(reason)); process.exitCode = 1 })
