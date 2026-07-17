import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { NodeType } from '../graph/schema'
import { httpRequest, multipartUpload, followRedirects, omitHeader } from '../tools/http-tools'
import { recordTestCase } from '../tools/record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from '../tools/observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from '../tools/session-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { readAppModelSection, writeAppModelSection } from '../tools/app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from '../tools/recon-tools'
import { askUser } from '../tools/interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams, upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings } from '../graph/tools'
import { getCapturedHeaders, storeSession } from '../tools/har-tools'
import { getFullContext } from '../manager/tools/get-full-context'
import { addDiscovery } from '../tools/user-discovery'
import { detectChainsTool, verifyChainsTool } from '../tools/detect-chains-tool'
import { detectReactions, getDialogEvidence, getRecentChanges } from '../tools/reaction-tools'
import { readReportTool, setForensicLog, getForensicLog } from '../tools/report-tools'
import { loadSkillReference, searchSkillTool } from '../tools/skill-tools'
import { encodeDecode } from '../tools/encode-decode'
import { saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow } from '../tools/flow-tools'
import { buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus } from '../tools/research-tools'
import { runPrimitiveTool } from '../primitives'
import { runCampaignTool } from '../campaign/campaign-tool'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import { listToolsTool, loadToolTool } from '../extensions/tool-tools'
import { getGlobalToolRegistry } from '../extensions/tool-registry'
import { Logger } from '../utils/logger'

export type ToolRegistry = {
  // HTTP Tools
  httpRequest: typeof httpRequest
  multipartUpload: typeof multipartUpload
  followRedirects: typeof followRedirects
  omitHeader: typeof omitHeader
  
  // Test Recording Tools
  recordTestCase: typeof recordTestCase
  
  // Observation Tools
  parseResponse: typeof parseResponse
  evaluateRendered: typeof evaluateRendered
  measureTiming: typeof measureTiming
  compareResponses: typeof compareResponses
  checkWaf: typeof checkWaf
  findEndpointsInResponse: typeof findEndpointsInResponse
  
  // Session Tools
  extractSessionCookie: typeof extractSessionCookie
  extractCsrfToken: typeof extractCsrfToken
  useSession: typeof useSession
  
  // Control Tools
  recordEvidence: typeof recordEvidence
  writeFinding: typeof writeFinding
  
  // Graph Tools (focused)
  queryGraph: typeof queryGraph
  updateGraph: typeof updateGraph
  getTestCoverage: typeof getTestCoverage
  getAttackPath: typeof getAttackPath
  getUntestedActions: typeof getUntestedActions
  getAuthFlows: typeof getAuthFlows
  getTargetSummary: typeof getTargetSummary
  getEndpointsWithParams: typeof getEndpointsWithParams
  upsertPage: typeof upsertPage
  addAction: typeof addAction
  addInput: typeof addInput
  addEndpoint: typeof addEndpoint
  addFinding: typeof addFinding
  addAuthFlow: typeof addAuthFlow
  addRBACRole: typeof addRBACRole
  addAttack: typeof addAttack
  chainFindings: typeof chainFindings
  
  // App Model Tools
  readAppModelSection: typeof readAppModelSection
  writeAppModelSection: typeof writeAppModelSection
  
  // Recon Tools
  runRecon: typeof runRecon
  graphqlIntrospect: typeof graphqlIntrospect
  jwtDecode: typeof jwtDecode
  frameworkFingerprint: typeof frameworkFingerprint
  cloudMetadataProbe: typeof cloudMetadataProbe
  
  // Interaction Tools
  askUser: typeof askUser
  
  // OAST Tools
  getOastUrlTool: typeof getOastUrlTool
  checkOastCallbacks: typeof checkOastCallbacks
  clearOastCallbacks: typeof clearOastCallbacks
  
  // HAR/Session Tools
  getCapturedHeaders: typeof getCapturedHeaders
  storeSession: typeof storeSession
  
  // Manager Tools
  getFullContext: typeof getFullContext
  
  // User Discovery
  addDiscovery: typeof addDiscovery
  
  // Chain Detection
  detectChains: typeof detectChainsTool
  verifyChains: typeof verifyChainsTool
  
  // Report Tools
  readReport: typeof readReportTool
  
  // Skill Tools
  loadSkillReference: typeof loadSkillReference
  searchSkills: typeof searchSkillTool
  
  // Encode/Decode
  encodeDecode: typeof encodeDecode

  // Flow Tools (Human-in-the-Loop)
  saveSession: typeof saveSession
  restoreSession: typeof restoreSession
  observeHumanActions: typeof observeHumanActions
  saveLearnedFlow: typeof saveLearnedFlow
  reproduceFlow: typeof reproduceFlow

  // Reaction Tools (UI feedback detection)
  detectReactions: typeof detectReactions
  getDialogEvidence: typeof getDialogEvidence
  getRecentChanges: typeof getRecentChanges

  // Research Tools (v9 bug-bounty brain)
  buildResearchMap: typeof buildResearchMap
  planResearchExperiments: typeof planResearchExperiments
  compareResearchResponses: typeof compareResearchResponses
  recordFindingCandidate: typeof recordFindingCandidate
  assessCandidateReportability: typeof assessCandidateReportability
  getResearchStatus: typeof getResearchStatus

  // Technique Primitives (Phase 2)
  runPrimitive: typeof runPrimitiveTool
  // Campaign Dispatch (Phase 2 / T2.6)
  runCampaign: typeof runCampaignTool
  // Outcome Feedback (Phase 4 / T4.3)
  recordOutcome: typeof recordOutcomeTool

  // Extension Discovery (Phase 3)
  listTools: typeof listToolsTool
  loadTool: typeof loadToolTool
}

// Centralized tool registry with consistent IDs
export function createToolRegistry(logger?: Logger): ToolRegistry {
  const log = logger || new Logger('ToolRegistry')
  
  log.info('Creating centralized tool registry')
  
  const registry: ToolRegistry = {
    // HTTP Tools
    httpRequest,
    multipartUpload,
    followRedirects,
    omitHeader,
    
    // Test Recording Tools
    recordTestCase,
    
    // Observation Tools
    parseResponse,
    evaluateRendered,
    measureTiming,
    compareResponses,
    checkWaf,
    findEndpointsInResponse,
    
    // Session Tools
    extractSessionCookie,
    extractCsrfToken,
    useSession,
    
    // Control Tools
    recordEvidence,
    writeFinding,
    
    // Graph Tools (focused)
    queryGraph,
    updateGraph,
    getTestCoverage,
    getAttackPath,
    getUntestedActions,
    getAuthFlows,
    getTargetSummary,
    getEndpointsWithParams,
    upsertPage,
    addAction,
    addInput,
    addEndpoint,
    addFinding,
    addAuthFlow,
    addRBACRole,
    addAttack,
    chainFindings,
    
    // App Model Tools
    readAppModelSection,
    writeAppModelSection,
    
    // Recon Tools
    runRecon,
    graphqlIntrospect,
    jwtDecode,
    frameworkFingerprint,
    cloudMetadataProbe,
    
    // Interaction Tools
    askUser,
    
    // OAST Tools
    getOastUrlTool,
    checkOastCallbacks,
    clearOastCallbacks,
    
    // HAR/Session Tools
    getCapturedHeaders,
    storeSession,
    
    // Manager Tools
    getFullContext,
    
    // User Discovery
    addDiscovery,
    
    // Chain Detection
    detectChains: detectChainsTool,
    verifyChains: verifyChainsTool,
    
    // Report Tools
    readReport: readReportTool,
    
    // Skill Tools
    loadSkillReference,
    searchSkills: searchSkillTool,
    
    // Encode/Decode
    encodeDecode,

    // Flow Tools (Human-in-the-Loop)
    saveSession,
    restoreSession,
    observeHumanActions,
    saveLearnedFlow,
    reproduceFlow,

    // Reaction Tools (UI feedback detection)
    detectReactions,
    getDialogEvidence,
    getRecentChanges,

    // Research Tools (v9 bug-bounty brain)
    buildResearchMap,
    planResearchExperiments,
    compareResearchResponses,
    recordFindingCandidate,
    assessCandidateReportability,
    getResearchStatus,

    // Technique Primitives (Phase 2)
    runPrimitive: runPrimitiveTool,
    // Campaign Dispatch (Phase 2 / T2.6)
    runCampaign: runCampaignTool,
    // Outcome Feedback (Phase 4 / T4.3)
    recordOutcome: recordOutcomeTool,

    // Extension Discovery (Phase 3)
    listTools: listToolsTool,
    loadTool: loadToolTool,
  }

  // Delegate built-ins into the DynamicToolRegistry so MCP/plugin tools resolve
  // through the same registry surface (Phase 1.2).
  getGlobalToolRegistry().registerBuiltins(registry)

  return registry
}

// Tool ID validation
export const TOOL_IDS = [
  'httpRequest',
  'multipartUpload',
  'followRedirects',
  'omitHeader',
  'recordTestCase',
  'parseResponse',
  'evaluateRendered',
  'measureTiming',
  'compareResponses',
  'checkWaf',
  'findEndpointsInResponse',
  'extractSessionCookie',
  'extractCsrfToken',
  'useSession',
  'recordEvidence',
  'writeFinding',
  'queryGraph',
  'updateGraph',
  'getTestCoverage',
  'getAttackPath',
  'getUntestedActions',
  'getAuthFlows',
  'getTargetSummary',
  'getEndpointsWithParams',
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
  'addFinding',
  'addAuthFlow',
  'addRBACRole',
  'addAttack',
  'chainFindings',
  'readAppModelSection',
  'writeAppModelSection',
  'runRecon',
  'graphqlIntrospect',
  'jwtDecode',
  'frameworkFingerprint',
  'cloudMetadataProbe',
  'askUser',
  'getOastUrlTool',
  'checkOastCallbacks',
  'clearOastCallbacks',
  'getCapturedHeaders',
  'storeSession',
  'getFullContext',
  'addDiscovery',
  'detectChains',
  'verifyChains',
  'readReport',
  'loadSkillReference',
  'listSkills',
  'searchSkills',
  'encodeDecode',
  'saveSession',
  'restoreSession',
  'observeHumanActions',
  'saveLearnedFlow',
  'reproduceFlow',
  'detectReactions',
  'getDialogEvidence',
  'getRecentChanges',
  'buildResearchMap',
  'planResearchExperiments',
  'compareResearchResponses',
  'recordFindingCandidate',
  'assessCandidateReportability',
  'getResearchStatus',
  'runPrimitive',
  'runCampaign',
  'recordOutcome',
  'listTools',
  'loadTool',
] as const

export type ToolId = typeof TOOL_IDS[number]

// Tool metadata for documentation and validation
export const TOOL_METADATA: Partial<Record<ToolId, {
  id: string
  description: string
  category: 'http' | 'observation' | 'session' | 'control' | 'graph' | 'app-model' | 'recon' | 'interaction' | 'oast' | 'research'
  inputSchema: any
  outputSchema: any
}>> = {
  httpRequest: {
    id: 'httpRequest',
    description: 'Send an HTTP request with method/headers/body/cookies. Does NOT follow redirects.',
    category: 'http',
    inputSchema: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
      url: z.string().url().describe('Target URL'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body'),
      timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        body: z.string(),
        duration: z.number(),
        url: z.string(),
        redirected: z.boolean(),
      }),
    }),
  },
  multipartUpload: {
    id: 'multipartUpload',
    description: 'Upload files using multipart/form-data',
    category: 'http',
    inputSchema: z.object({
      url: z.string().url().describe('Target URL'),
      files: z.array(z.object({
        name: z.string(),
        content: z.string(),
        mimeType: z.string(),
      })),
      fields: z.record(z.string(), z.string()).optional().describe('Form fields'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        body: z.string(),
        duration: z.number(),
      }),
    }),
  },
  followRedirects: {
    id: 'followRedirects',
    description: 'Follow HTTP redirects up to maxRedirects times',
    category: 'http',
    inputSchema: z.object({
      url: z.string().url().describe('Target URL'),
      maxRedirects: z.number().int().positive().default(10).describe('Maximum redirects to follow'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body'),
      timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        finalUrl: z.string(),
        status: z.number(),
        headers: z.record(z.string(), z.string()),
        body: z.string(),
        duration: z.number(),
        redirectChain: z.array(z.string()),
      }),
    }),
  },
  omitHeader: {
    id: 'omitHeader',
    description: 'Remove a header from HTTP request',
    category: 'http',
    inputSchema: z.object({
      headers: z.record(z.string(), z.string()).describe('Request headers'),
      headerName: z.string().describe('Header name to remove'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        headers: z.record(z.string(), z.string()),
        removed: z.boolean(),
      }),
    }),
  },
  recordTestCase: {
    id: 'recordTestCase',
    description: 'Record a test case for later playback',
    category: 'observation',
    inputSchema: z.object({
      name: z.string().describe('Test case name'),
      description: z.string().describe('Test case description'),
      steps: z.array(z.object({
        action: z.string(),
        target: z.string(),
        value: z.string().optional(),
        expected: z.string().optional(),
      })),
      tags: z.array(z.string()).optional().describe('Test case tags'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        steps: z.array(z.object({
          action: z.string(),
          target: z.string(),
          value: z.string().optional(),
          expected: z.string().optional(),
        })),
        tags: z.array(z.string()),
        createdAt: z.string(),
      }),
    }),
  },
  parseResponse: {
    id: 'parseResponse',
    description: 'Parse and analyze HTTP response',
    category: 'observation',
    inputSchema: z.object({
      response: z.string().describe('HTTP response body'),
      contentType: z.string().optional().describe('Content-Type header'),
      statusCode: z.number().optional().describe('HTTP status code'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        contentType: z.string(),
        isJson: z.boolean(),
        isHtml: z.boolean(),
        isXml: z.boolean(),
        isText: z.boolean(),
        extractedData: z.record(z.string(), z.unknown()),
        errors: z.array(z.string()),
        warnings: z.array(z.string()),
      }),
    }),
  },
  evaluateRendered: {
    id: 'evaluateRendered',
    description: 'Evaluate if response was properly rendered',
    category: 'observation',
    inputSchema: z.object({
      html: z.string().describe('HTML content to evaluate'),
      expectedElements: z.array(z.string()).optional().describe('Expected HTML elements'),
      excludeElements: z.array(z.string()).optional().describe('Elements to exclude from evaluation'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        rendered: z.boolean(),
        missingElements: z.array(z.string()),
        presentElements: z.array(z.string()),
        score: z.number(),
        issues: z.array(z.string()),
      }),
    }),
  },
  measureTiming: {
    id: 'measureTiming',
    description: 'Measure response timing metrics',
    category: 'observation',
    inputSchema: z.object({
      url: z.string().url().describe('Target URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body'),
      timeoutMs: z.number().int().positive().default(10000).describe('Timeout in milliseconds'),
      samples: z.number().int().positive().default(5).describe('Number of samples to collect'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        averageTime: z.number(),
        minTime: z.number(),
        maxTime: z.number(),
        medianTime: z.number(),
        stdDev: z.number(),
        samples: z.number(),
        outliers: z.number(),
      }),
    }),
  },
  compareResponses: {
    id: 'compareResponses',
    description: 'Compare two HTTP responses',
    category: 'observation',
    inputSchema: z.object({
      response1: z.string().describe('First response body'),
      response2: z.string().describe('Second response body'),
      contentType: z.string().optional().describe('Content-Type header'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        identical: z.boolean(),
        differences: z.array(z.object({
          type: z.enum(['content', 'structure', 'size']),
          description: z.string(),
          severity: z.enum(['low', 'medium', 'high']),
        })),
        similarity: z.number(),
        summary: z.string(),
      }),
    }),
  },
  checkWaf: {
    id: 'checkWaf',
    description: 'Check for Web Application Firewall detection',
    category: 'observation',
    inputSchema: z.object({
      response: z.string().describe('HTTP response body'),
      headers: z.record(z.string(), z.string()).describe('HTTP headers'),
      statusCode: z.number().describe('HTTP status code'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        detected: z.boolean(),
        type: z.string().optional(),
        evidence: z.array(z.string()),
        confidence: z.number(),
        recommendations: z.array(z.string()),
      }),
    }),
  },
  findEndpointsInResponse: {
    id: 'findEndpointsInResponse',
    description: 'Find potential endpoints in HTTP response',
    category: 'observation',
    inputSchema: z.object({
      html: z.string().describe('HTML content to search'),
      baseDomain: z.string().describe('Base domain for relative URLs'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        endpoints: z.array(z.string()),
        methods: z.array(z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])),
        forms: z.array(z.object({
          action: z.string(),
          method: z.string(),
          inputs: z.array(z.string()),
        })),
        apiEndpoints: z.array(z.string()),
        confidence: z.number(),
      }),
    }),
  },
  extractSessionCookie: {
    id: 'extractSessionCookie',
    description: 'Extract session cookie from HTTP response',
    category: 'session',
    inputSchema: z.object({
      headers: z.record(z.string(), z.string()).describe('HTTP response headers'),
      cookieName: z.string().optional().describe('Specific cookie name to extract'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        cookies: z.array(z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string(),
          secure: z.boolean(),
          httpOnly: z.boolean(),
          expires: z.string().optional(),
        })),
        sessionCookie: z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string(),
          secure: z.boolean(),
          httpOnly: z.boolean(),
          expires: z.string().optional(),
        }).optional(),
      }),
    }),
  },
  extractCsrfToken: {
    id: 'extractCsrfToken',
    description: 'Extract CSRF token from HTTP response',
    category: 'session',
    inputSchema: z.object({
      html: z.string().describe('HTML content to search'),
      inputName: z.string().optional().describe('Specific input name to look for'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        tokens: z.array(z.object({
          name: z.string(),
          value: z.string(),
          inputType: z.string(),
        })),
        csrfToken: z.string().optional(),
      }),
    }),
  },
  useSession: {
    id: 'useSession',
    description: 'Use existing session for authenticated requests',
    category: 'session',
    inputSchema: z.object({
      sessionId: z.string().describe('Session ID to use'),
      url: z.string().url().describe('Target URL'),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).default('GET').describe('HTTP method'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
      body: z.string().optional().describe('Request body'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        sessionId: z.string(),
        used: z.boolean(),
        response: z.object({
          status: z.number(),
          headers: z.record(z.string(), z.string()),
          body: z.string(),
          duration: z.number(),
        }),
      }),
    }),
  },
  recordEvidence: {
    id: 'recordEvidence',
    description: 'Record an evidence item that will be included in the next writeFinding call',
    category: 'control',
    inputSchema: z.object({
      type: z.enum(['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
      data: z.string(),
      label: z.string(),
      session: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        recorded: z.boolean(),
        timestamp: z.number(),
        evidence: z.object({
          type: z.string(),
          data: z.string(),
          label: z.string(),
          timestamp: z.number(),
          session: z.string().optional(),
        }),
      }),
    }),
  },
  writeFinding: {
    id: 'writeFinding',
    description: 'Emit a finalized finding with accumulated evidence',
    category: 'control',
    inputSchema: z.object({
      type: z.string(),
      endpoint: z.string(),
      technique: z.string(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
      confidence: z.number().min(0).max(1),
      description: z.string(),
      evidence: z.array(z.string()).optional(),
      remediation: z.string().optional(),
      cwe: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        id: z.string(),
        type: z.string(),
        endpoint: z.string(),
        technique: z.string(),
        severity: z.string(),
        confidence: z.number(),
        description: z.string(),
        evidence: z.array(z.string()),
        remediation: z.string().optional(),
        cwe: z.string().optional(),
        tags: z.array(z.string()),
        createdAt: z.string(),
      }),
    }),
  },
  queryGraph: {
    id: 'queryGraph',
    description:
      'Query the knowledge graph for nodes by type and filters. Returns the matching nodes (never a truncated summary). ' +
      'Discover the valid node types via getGraphSchema before filtering by `type`. ' +
      'When at least one filter is supplied, results are scoped; set `limit: 0` to return the entire scoped result set with no cap. ' +
      'Use this to pull the full set of nodes you need to reason over; do not rely on a pre-summarized view.',
    category: 'graph',
    inputSchema: z.object({
      type: z.nativeEnum(NodeType).optional().describe('Node type to filter by. Discover valid values via getGraphSchema.'),
      url: z.string().optional(),
      method: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional().default(50).describe('Max nodes to return. 0 = unbounded (entire scoped result set).'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.array(z.object({
        id: z.string(),
        type: z.string(),
        label: z.string(),
        properties: z.record(z.string(), z.unknown()),
        createdAt: z.number(),
        updatedAt: z.number(),
      })),
    }),
  },
  updateGraph: {
    id: 'updateGraph',
    description: 'Write data to the knowledge graph. Actions: upsertPage, addAction, addInput, addEndpoint, addTest, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings.',
    category: 'graph',
    inputSchema: z.object({
      action: z.enum(['upsertPage', 'addAction', 'addInput', 'addEndpoint', 'addTest', 'addFinding', 'addAuthFlow', 'addRBACRole', 'addAttack', 'chainFindings']),
      pageUrl: z.string().optional(),
      pageData: z.record(z.string(), z.unknown()).optional(),
      pageId: z.string().optional(),
      actionData: z.record(z.string(), z.unknown()).optional(),
      inputData: z.record(z.string(), z.unknown()).optional(),
      endpointData: z.record(z.string(), z.unknown()).optional(),
      testData: z.record(z.string(), z.unknown()).optional(),
      findingData: z.record(z.string(), z.unknown()).optional(),
      authFlowData: z.record(z.string(), z.unknown()).optional(),
      rbacData: z.record(z.string(), z.unknown()).optional(),
      attackData: z.record(z.string(), z.unknown()).optional(),
      fromId: z.string().optional(),
      toId: z.string().optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  getTestCoverage: {
    id: 'getTestCoverage',
    description: 'Get test coverage for an endpoint',
    category: 'graph',
    inputSchema: z.object({
      endpointId: z.string().describe('Endpoint ID'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        tests: z.array(z.object({
          id: z.string(),
          type: z.string(),
          status: z.string(),
          endpoint: z.string(),
          technique: z.string(),
          payload: z.string(),
        })),
        coverage: z.number(),
        untestedActions: z.array(z.string()),
      }),
    }),
  },
  getAttackPath: {
    id: 'getAttackPath',
    description: 'Get attack path from finding',
    category: 'graph',
    inputSchema: z.object({
      findingId: z.string().describe('Finding ID'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        path: z.array(z.object({
          id: z.string(),
          type: z.string(),
          label: z.string(),
          properties: z.record(z.string(), z.unknown()),
        })),
        length: z.number(),
        severity: z.string(),
        confidence: z.number(),
      }),
    }),
  },
  getUntestedActions: {
    id: 'getUntestedActions',
    description: 'Get untested actions in the graph',
    category: 'graph',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        actions: z.array(z.object({
          id: z.string(),
          type: z.string(),
          label: z.string(),
          properties: z.record(z.string(), z.unknown()),
        })),
        count: z.number(),
      }),
    }),
  },
  getAuthFlows: {
    id: 'getAuthFlows',
    description: 'Get authentication flows from the graph',
    category: 'graph',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        flows: z.array(z.object({
          id: z.string(),
          type: z.string(),
          label: z.string(),
          properties: z.record(z.string(), z.unknown()),
        })),
        count: z.number(),
      }),
    }),
  },
  upsertPage: {
    id: 'upsertPage',
    description: 'Record or update a page in the knowledge graph. Call this after navigating to a URL with stagehand_navigate.',
    category: 'graph',
    inputSchema: z.object({
      url: z.string().describe('The page URL'),
      title: z.string().optional().describe('Page title'),
      method: z.string().optional().describe('HTTP method (default GET)'),
      tags: z.array(z.string()).optional().describe('Semantic tags'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addAction: {
    id: 'addAction',
    description: 'Record a user interaction (click, fill, submit) on a page.',
    category: 'graph',
    inputSchema: z.object({
      pageId: z.string().describe('Page node ID (format: page:<url>)'),
      actionType: z.string().describe('Action type: click, fill, submit, navigate, scroll'),
      selector: z.string().optional().describe('CSS selector or description'),
      url: z.string().optional().describe('Action URL if different from page'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addInput: {
    id: 'addInput',
    description: 'Record a form field or input element discovered on a page.',
    category: 'graph',
    inputSchema: z.object({
      actionId: z.string().describe('Parent action node ID'),
      selector: z.string().describe('CSS selector or element description'),
      inputType: z.string().optional().describe('Input type: text, password, email, checkbox, etc.'),
      name: z.string().optional().describe('Input name attribute'),
      placeholder: z.string().optional().describe('Placeholder text'),
      required: z.boolean().optional().describe('Whether the field is required'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addEndpoint: {
    id: 'addEndpoint',
    description: 'Record a discovered API endpoint with its parameters. Use this for every unique URL/endpoint found during crawling or testing.',
    category: 'graph',
    inputSchema: z.object({
      url: z.string().describe('Full endpoint URL'),
      method: z.string().describe('HTTP method: GET, POST, PUT, DELETE, PATCH'),
      params: z.array(z.object({
        name: z.string(),
        type: z.string().optional(),
        location: z.string().optional().describe('query, body, path, header'),
        required: z.boolean().optional(),
      })).optional().describe('Endpoint parameters'),
      authRequired: z.boolean().optional().describe('Whether auth is needed'),
      authType: z.string().optional().describe('Auth type: Bearer, Cookie, Basic, API-Key'),
      tags: z.array(z.string()).optional().describe('Semantic tags'),
      description: z.string().optional().describe('Endpoint description'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addFinding: {
    id: 'addFinding',
    description: 'Record a confirmed security finding with evidence and severity.',
    category: 'graph',
    inputSchema: z.object({
      endpoint: z.string().describe('Affected endpoint URL'),
      technique: z.string().describe('Vulnerability technique (e.g., SQL Injection, XSS)'),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
      confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
      description: z.string().describe('Detailed description'),
      evidence: z.array(z.string()).optional().describe('Evidence items'),
      remediation: z.string().optional().describe('How to fix'),
      cwe: z.string().optional().describe('CWE ID'),
      tags: z.array(z.string()).optional().describe('Tags'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addAuthFlow: {
    id: 'addAuthFlow',
    description: 'Record an authentication flow (login, logout, token refresh, OAuth).',
    category: 'graph',
    inputSchema: z.object({
      flowType: z.string().describe('Flow type: login, logout, token_refresh, oauth, registration'),
      steps: z.array(z.string()).optional().describe('Flow steps description'),
      reusable: z.boolean().optional().describe('Whether this flow is reusable'),
      startUrl: z.string().optional().describe('Starting URL'),
      endUrl: z.string().optional().describe('Ending URL after flow'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addRBACRole: {
    id: 'addRBACRole',
    description: 'Record an RBAC role with its accessible/inaccessible endpoints.',
    category: 'graph',
    inputSchema: z.object({
      roleName: z.string().describe('Role name'),
      accessibleEndpoints: z.array(z.string()).optional().describe('Endpoints this role can access'),
      inaccessibleEndpoints: z.array(z.string()).optional().describe('Endpoints this role cannot access'),
      visibleUIElements: z.array(z.string()).optional().describe('UI elements visible to this role'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  addAttack: {
    id: 'addAttack',
    description: 'Record an attack attempt with its technique, payload, and result.',
    category: 'graph',
    inputSchema: z.object({
      technique: z.string().describe('Attack technique'),
      payload: z.string().describe('Payload used'),
      vulnerable: z.boolean().describe('Whether the target was vulnerable'),
      confidence: z.number().min(0).max(1).describe('Confidence level'),
      endpoint: z.string().optional().describe('Target endpoint'),
      response: z.string().optional().describe('Response snippet'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  chainFindings: {
    id: 'chainFindings',
    description: 'Chain two findings together to build an attack path.',
    category: 'graph',
    inputSchema: z.object({
      fromId: z.string().describe('Source finding ID'),
      toId: z.string().describe('Target finding ID'),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  readAppModelSection: {
    id: 'readAppModelSection',
    description: 'Read a section from the application model JSON file',
    category: 'app-model',
    inputSchema: z.object({
      section: z.string().describe('Section name to read'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.unknown(),
      error: z.string().optional(),
    }),
  },
  writeAppModelSection: {
    id: 'writeAppModelSection',
    description: 'Write or append data to a section of the application model JSON file',
    category: 'app-model',
    inputSchema: z.object({
      section: z.string().describe('Section name to write to'),
      data: z.any().describe('Data to write'),
      append: z.boolean().default(false).describe('Whether to append to existing data'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        written: z.boolean(),
        section: z.string(),
        itemCount: z.number(),
      }),
      error: z.string().optional(),
    }),
  },
  runRecon: {
    id: 'runRecon',
    description: 'Run reconnaissance on target',
    category: 'recon',
    inputSchema: z.object({
      target: z.string().url().describe('Target URL'),
      techniques: z.array(z.string()).optional().describe('Recon techniques to use'),
      timeout: z.number().int().positive().default(30).describe('Timeout in seconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        endpoints: z.array(z.string()),
        technologies: z.array(z.string()),
        vulnerabilities: z.array(z.string()),
        suggestions: z.array(z.string()),
        duration: z.number(),
      }),
    }),
  },
  graphqlIntrospect: {
    id: 'graphqlIntrospect',
    description: 'Perform GraphQL introspection',
    category: 'recon',
    inputSchema: z.object({
      url: z.string().url().describe('GraphQL endpoint URL'),
      headers: z.record(z.string(), z.string()).optional().describe('Request headers'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        schema: z.string(),
        types: z.array(z.string()),
        queries: z.array(z.string()),
        mutations: z.array(z.string()),
        duration: z.number(),
      }),
    }),
  },
  jwtDecode: {
    id: 'jwtDecode',
    description: 'Decode JWT token',
    category: 'recon',
    inputSchema: z.object({
      token: z.string().describe('JWT token to decode'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        header: z.record(z.string(), z.unknown()),
        payload: z.record(z.string(), z.unknown()),
        signature: z.string(),
        valid: z.boolean(),
        expired: z.boolean(),
      }),
    }),
  },
  frameworkFingerprint: {
    id: 'frameworkFingerprint',
    description: 'Detect web framework',
    category: 'recon',
    inputSchema: z.object({
      html: z.string().describe('HTML content to analyze'),
      headers: z.record(z.string(), z.string()).optional().describe('HTTP headers'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        framework: z.string(),
        version: z.string().optional(),
        confidence: z.number(),
        evidence: z.array(z.string()),
      }),
    }),
  },
  cloudMetadataProbe: {
    id: 'cloudMetadataProbe',
    description: 'Probe for cloud metadata endpoints',
    category: 'recon',
    inputSchema: z.object({
      timeout: z.number().int().positive().default(10).describe('Timeout in seconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        endpoints: z.array(z.string()),
        responses: z.array(z.object({
          endpoint: z.string(),
          status: z.number(),
          data: z.string(),
        })),
        findings: z.array(z.string()),
      }),
    }),
  },
  askUser: {
    id: 'askUser',
    description: 'Ask user for input',
    category: 'interaction',
    inputSchema: z.object({
      question: z.string().describe('Question to ask user'),
      options: z.array(z.string()).optional().describe('Multiple choice options'),
      timeout: z.number().int().positive().default(60).describe('Timeout in seconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        answer: z.string(),
        timestamp: z.string(),
        timedOut: z.boolean(),
      }),
    }),
  },
  getOastUrlTool: {
    id: 'getOastUrl',
    description: 'Get OAST callback URL',
    category: 'oast',
    inputSchema: z.object({
      provider: z.string().optional().describe('OAST provider'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        url: z.string(),
        provider: z.string(),
        id: z.string(),
      }),
    }),
  },
  checkOastCallbacks: {
    id: 'checkOastCallbacks',
    description: 'Check OAST callbacks',
    category: 'oast',
    inputSchema: z.object({
      timeout: z.number().int().positive().default(30).describe('Timeout in seconds'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        callbacks: z.array(z.object({
          url: z.string(),
          response: z.string(),
          timestamp: z.string(),
        })),
        count: z.number(),
      }),
    }),
  },
  clearOastCallbacks: {
    id: 'clearOastCallbacks',
    description: 'Clear OAST callbacks',
    category: 'oast',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        cleared: z.boolean(),
        count: z.number(),
      }),
    }),
  },
  getCapturedHeaders: {
    id: 'getCapturedHeaders',
    description: 'Get real captured headers for a URL',
    category: 'oast',
    inputSchema: z.object({
      url: z.string().describe('Target URL or URL pattern to match'),
      role: z.string().optional().describe('Session role'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        headers: z.record(z.string(), z.string()),
        authType: z.string().nullable(),
        source: z.string(),
      }),
    }),
  },
  storeSession: {
    id: 'storeSession',
    description: 'Store session headers for a URL',
    category: 'oast',
    inputSchema: z.object({
      url: z.string().describe('Target URL'),
      headers: z.record(z.string(), z.string()).describe('Headers to store'),
      role: z.string().optional().describe('Session role'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        stored: z.boolean(),
        url: z.string(),
      }),
    }),
  },
  getFullContext: {
    id: 'getFullContext',
    description: 'Get complete context for a target: all endpoints with headers, all findings, all tests.',
    category: 'graph',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  addDiscovery: {
    id: 'addDiscovery',
    description: 'Add a user-reported finding or observation to the graph.',
    category: 'control',
    inputSchema: z.object({
      endpoint: z.string().describe('Affected endpoint URL'),
      technique: z.string().describe('Vulnerability technique'),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).default('medium'),
      confidence: z.number().min(0).max(1).default(0.8),
      description: z.string().describe('Description of the finding'),
      evidence: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  detectChains: {
    id: 'detectChains',
    description: 'Detect potential attack chains between findings in the knowledge graph.',
    category: 'graph',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        chains: z.array(z.any()),
        count: z.number(),
      }),
    }),
  },
  verifyChains: {
    id: 'verifyChains',
    description: 'Detect attack chains and PROVE each one against the EvidenceGate; returns verification per chain and severity escalation only when fully evidenced.',
    category: 'graph',
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        chains: z.array(z.any()),
        verifiedCount: z.number(),
        escalatedCount: z.number(),
      }),
    }),
  },
  readReport: {
    id: 'readReport',
    description: 'Read the forensic report of all actions taken during this session.',
    category: 'graph',
    inputSchema: z.object({
      section: z.enum(['summary', 'findings', 'timeline', 'endpoints', 'all']).default('summary'),
      limit: z.number().int().positive().default(50),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  loadSkillReference: {
    id: 'loadSkillReference',
    description: 'Load a specific reference document from a skill for detailed methodology guidance.',
    category: 'interaction' as const,
    inputSchema: z.object({
      skillId: z.string().describe('Skill ID (e.g. "pentest-flow", "web-pentest")'),
      referenceId: z.string().optional().describe('Reference document ID. If omitted, lists available references.'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  searchSkills: {
    id: 'searchSkills',
    description: 'Search available skills by keyword to find relevant methodology guidance.',
    category: 'interaction' as const,
    inputSchema: z.object({
      query: z.string().describe('Search query (e.g. "SQL injection", "race condition")'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  encodeDecode: {
    id: 'encodeDecode',
    description: 'Encode or decode data in various formats: base64, hex, URL, HTML, JWT, or auto-detect.',
    category: 'observation' as const,
    inputSchema: z.object({
      operation: z.enum(['base64Encode', 'base64Decode', 'hexEncode', 'hexDecode', 'urlEncode', 'urlDecode', 'htmlEncode', 'htmlDecode', 'jwtDecode', 'autoDecode']).describe('Operation to perform'),
      input: z.string().describe('Input data to encode or decode'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.any(),
    }),
  },
  saveSession: {
    id: 'saveSession',
    description: 'Save the current browser session (cookies, localStorage) to the knowledge graph for reuse.',
    category: 'session' as const,
    inputSchema: z.object({ name: z.string(), description: z.string().optional(), flowSteps: z.array(z.any()).optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  restoreSession: {
    id: 'restoreSession',
    description: 'Restore a previously saved browser session by setting cookies and localStorage.',
    category: 'session' as const,
    inputSchema: z.object({ name: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  observeHumanActions: {
    id: 'observeHumanActions',
    description: 'Read human actions captured from the browser.',
    category: 'interaction' as const,
    inputSchema: z.object({ sinceSeconds: z.number().optional(), flowOnly: z.boolean().optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  saveLearnedFlow: {
    id: 'saveLearnedFlow',
    description: 'Save a learned action flow to the knowledge graph for future reproduction.',
    category: 'control' as const,
    inputSchema: z.object({ name: z.string(), flowType: z.string(), actions: z.array(z.any()), startUrl: z.string().optional(), endUrl: z.string().optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  reproduceFlow: {
    id: 'reproduceFlow',
    description: 'Reproduce a saved action flow in the browser.',
    category: 'control' as const,
    inputSchema: z.object({ flowName: z.string() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  detectReactions: {
    id: 'detectReactions',
    description: 'Detect UI reactions after a browser action (modals, toasts, errors, dialogs).',
    category: 'observation' as const,
    inputSchema: z.object({ sinceSeconds: z.number().optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  getDialogEvidence: {
    id: 'getDialogEvidence',
    description: 'Check for native dialog evidence (alert/confirm/prompt) — useful for XSS proof.',
    category: 'observation' as const,
    inputSchema: z.object({ sinceSeconds: z.number().optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  getRecentChanges: {
    id: 'getRecentChanges',
    description: 'Get recent DOM changes — what changed on the page in the last N seconds.',
    category: 'observation' as const,
    inputSchema: z.object({ sinceSeconds: z.number().optional() }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  runPrimitive: {
    id: 'runPrimitive',
    description: 'Run a technique primitive against a target context; returns an evidence-gated confirmed/unconfirmed result.',
    category: 'observation' as const,
    inputSchema: z.object({
      primitiveId: z.string(),
      context: z.record(z.string(), z.any()),
      commit: z.boolean().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
  runCampaign: {
    id: 'runCampaign',
    description: 'Plan and execute a coverage campaign over discovered endpoints; runs all applicable technique primitives and persists evidence-gated confirmed findings. Returns findings + coverage.',
    category: 'observation' as const,
    inputSchema: z.object({
      maxSlices: z.number().int().positive().optional(),
      maxConcurrency: z.number().int().positive().optional(),
      includeAnonymous: z.boolean().optional(),
      roleFilter: z.array(z.string()).optional(),
      techniqueFilter: z.array(z.string()).optional(),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      findings: z.array(z.any()),
      coverage: z.any(),
      budgetExceeded: z.boolean(),
      slicesRun: z.number(),
    }),
  },
  recordOutcome: {
    id: 'recordOutcome',
    description: 'Record post-engagement client feedback for a reported finding: was it accepted, and did the remediation hold on retest? Updates technique effectiveness weights.',
    category: 'control' as const,
    inputSchema: z.object({
      findingId: z.string(),
      techniqueId: z.string(),
      accepted: z.boolean().optional(),
      fixed: z.boolean().optional(),
      retestHeld: z.boolean().optional(),
      severityAdjusted: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
      note: z.string().optional(),
      targetOrigin: z.string().optional(),
    }),
    outputSchema: z.object({ ok: z.boolean(), value: z.any() }),
  },
}

// Tool validation function
export function validateTool(toolId: string, tool: any): boolean {
  const metadata = TOOL_METADATA[toolId as ToolId]
  if (!metadata) {
    return false
  }
  
  // Basic validation - check if tool has required properties
  return tool && 
         tool.id === toolId && 
         typeof tool.description === 'string' &&
         typeof tool.execute === 'function'
}

// Get all tools by category
export function getToolsByCategory(category: typeof TOOL_METADATA[ToolId]['category']): ToolId[] {
  return Object.entries(TOOL_METADATA)
    .filter(([_, meta]) => meta.category === category)
    .map(([id]) => id as ToolId)
}

// Get tool documentation
export function getToolDocumentation(toolId: ToolId): {
  id: string
  description: string
  category: string
  inputSchema: any
  outputSchema: any
} {
  const metadata = TOOL_METADATA[toolId]
  if (!metadata) {
    throw new Error(`Tool ${toolId} not found`)
  }
  return metadata
}

// Export all tools for backward compatibility
export {
  httpRequest, multipartUpload, followRedirects, omitHeader,
  recordTestCase,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
  extractSessionCookie, extractCsrfToken, useSession,
  recordEvidence, writeFinding,
  queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows,
  upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings,
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
  loadSkillReference, searchSkillTool, encodeDecode,
  saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
  detectReactions, getDialogEvidence, getRecentChanges,
  runPrimitive,
  runCampaign,
  recordOutcomeTool,
}
