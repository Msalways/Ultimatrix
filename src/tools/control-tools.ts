import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type FindingNode } from '../graph/schema'
import { getGlobalWorkspace } from '../workspace'
import { generateFromFinding, type Finding } from '../generation/test-generator'
import { TestStorage } from '../generation/test-storage'
import { log } from '../utils/logger'
import { captureScreenshot } from '../browser/manager'

const evidenceBuffer = new Map<string, Array<{ type: string; data: string; label: string; timestamp: number; session?: string }>>()

export const recordEvidence = createTool({
  id: 'recordEvidence',
  description: 'Record an evidence item that will be included in the next writeFinding call.',
  inputSchema: z.object({
    type: z.enum(['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
    data: z.string(),
    label: z.string(),
    session: z.string().optional(),
    findingKey: z.string().optional().describe('Key to group evidence items. Defaults to "default".'),
  }),
  execute: async ({ type, data, label, session, findingKey }) => {
    const key = findingKey || 'default'
    const item = { type, data, label, timestamp: Date.now(), ...(session ? { session } : {}) }
    const existing = evidenceBuffer.get(key) || []
    existing.push(item)
    evidenceBuffer.set(key, existing)
    return {
      ok: true,
      value: {
        recorded: true,
        timestamp: item.timestamp,
        evidence: item,
        bufferedCount: existing.length,
      },
    }
  },
})

export const flushEvidence = (findingKey?: string): Array<{ type: string; data: string; label: string; timestamp: number; session?: string }> => {
  if (findingKey) {
    const items = evidenceBuffer.get(findingKey) || []
    evidenceBuffer.delete(findingKey)
    return items
  }
  const all: Array<{ type: string; data: string; label: string; timestamp: number; session?: string }> = []
  for (const [, items] of evidenceBuffer) {
    all.push(...items)
  }
  evidenceBuffer.clear()
  return all
}

function determineEvidenceLevel(items: Array<{ type: string }>): 'L1' | 'L2' | 'L3' | 'L4' {
  if (items.length === 0) return 'L1'
  const hasHarOrRaw = items.some(e => e.type === 'har_entry' || e.type === 'raw_request' || e.type === 'raw_response')
  if (hasHarOrRaw) return 'L4'
  const hasNonText = items.some(e => e.type !== 'text')
  if (hasNonText) return 'L3'
  return 'L2'
}

function buildFindingId(type: string, endpoint: string, param?: string): string {
  return `${type}:${endpoint}:${param || '*'}`
}

function sanitizeForFilename(input: string): string {
  return input.replace(/[<>:"/\\|?*]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '')
}

export const writeFinding = createTool({
  id: 'writeFinding',
  description: 'Emit a finalized finding with accumulated evidence and persist it to the knowledge graph.',
  inputSchema: z.object({
    type: z.string().describe('Vulnerability class (e.g. "sql_injection", "idor", "xss")'),
    endpoint: z.string().describe('Affected endpoint URL'),
    param: z.string().optional().describe('Affected parameter name'),
    method: z.string().optional().describe('HTTP method'),
    payload: z.string().optional().describe('Payload that triggered the finding'),
    description: z.string().optional().describe('Human-readable description'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    confidence: z.number().min(0).max(1),
    cwe: z.string().optional().describe('CWE ID'),
    remediation: z.string().optional(),
    findingKey: z.string().optional().describe('Key to pull buffered evidence from recordEvidence'),
  }),
  execute: async (args) => {
    const store = getGlobalGraphStore()
    const evidenceItems = flushEvidence(args.findingKey)

    // Phase E: Auto-screenshot on finding confirmation
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    const outputDir = target ? workspace.getTargetDir(target) : undefined
    const screenshotPath = await captureScreenshot(`finding-${args.type}`, outputDir)
    if (screenshotPath) {
      evidenceItems.push({ type: 'screenshot', data: screenshotPath, label: `Screenshot: ${args.type}`, timestamp: Date.now() })
    }

    const evidenceTexts = evidenceItems.map(e => `[${e.label}] ${e.data}`)

    const evidenceLevel = determineEvidenceLevel(evidenceItems)
    const findingId = buildFindingId(args.type, args.endpoint, args.param)

    const screenshotPaths = evidenceItems.filter(e => e.type === 'screenshot').map(e => e.data)

    const lifecycleStatus: FindingNode['properties']['lifecycleStatus'] =
      (args.severity === 'high' || args.severity === 'critical') && evidenceLevel === 'L1'
        ? 'pending_verification'
        : 'verified'

    const existingNodes = store.queryNodes(NodeType.FINDING) as FindingNode[]
    const duplicate = existingNodes.find(n => n.properties.findingId === findingId)

    let findingNode: FindingNode
    if (duplicate) {
      duplicate.properties = {
        ...duplicate.properties,
        severity: args.severity,
        evidence: evidenceTexts,
        screenshots: screenshotPaths,
        confidence: args.confidence,
        lifecycleStatus,
        evidenceLevel,
        ...(args.cwe ? { cwe: args.cwe } : {}),
        ...(args.remediation ? { remediation: args.remediation } : {}),
      }
      duplicate.updatedAt = Date.now()
      findingNode = duplicate
    } else {
      findingNode = store.addFinding({
        severity: args.severity,
        technique: args.type,
        endpoint: args.endpoint,
        evidence: evidenceTexts,
        screenshots: screenshotPaths,
        confidence: args.confidence,
        lifecycleStatus,
        evidenceLevel,
        findingId,
        ...(args.cwe ? { cwe: args.cwe } : {}),
        ...(args.remediation ? { remediation: args.remediation } : {}),
      })
    }

    const finding = {
      id: findingNode.id,
      type: args.type,
      endpoint: args.endpoint,
      param: args.param || '',
      method: args.method || 'GET',
      payload: args.payload || '',
      description: args.description || '',
      severity: args.severity,
      confidence: args.confidence,
      confirmed: args.confidence >= 0.7,
      evidence: evidenceItems,
      graphNodeId: findingNode.id,
      lifecycleStatus,
      evidenceLevel,
      findingId,
      deduplicated: !!duplicate,
    }

    autoGenerateTest(finding).catch(() => {})

    store.save().catch(err => log.error('Graph save failed after writeFinding: ' + String(err)))

    return { ok: true, value: finding }
  },
})

async function autoGenerateTest(finding: {
  id: string
  type: string
  endpoint: string
  param?: string
  method?: string
  payload?: string
  description?: string
  severity: string
  confidence: number
  evidence: Array<{ type: string; data: string; label: string; timestamp: number }>
}): Promise<void> {
  try {
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    if (!target) return

    const testFinding: Finding = {
      id: finding.id,
      title: `${finding.type} on ${finding.endpoint}`,
      severity: finding.severity as Finding['severity'],
      category: finding.type,
      description: finding.description || `${finding.type} vulnerability at ${finding.endpoint}`,
      evidence: finding.evidence.map(e => ({
        request: { method: finding.method || 'GET', url: finding.endpoint },
        response: { status: 200, body: e.data },
        description: e.label,
      })),
      request: {
        method: finding.method || 'GET',
        url: finding.endpoint,
      },
      firstSeen: new Date(),
      lastSeen: new Date(),
      status: 'open',
    }

    const test = generateFromFinding(testFinding)
    const storage = new TestStorage(workspace.getTargetDir(target))
    await storage.save([test])
    log.dim('Test generated: ' + test.id)
  } catch (err) {
    log.dim('Test generation skipped: ' + (err instanceof Error ? err.message : String(err)))
  }
}
