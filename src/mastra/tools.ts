import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { httpRequest, multipartUpload, followRedirects, omitHeader } from '../tools/http-tools'
import { recordTestCase } from '../tools/record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from '../tools/observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from '../tools/session-tools'
import { recordEvidence, writeFinding } from '../tools/control-tools'
import { readAppModelSection, writeAppModelSection } from '../tools/app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from '../tools/recon-tools'
import { askUser } from '../tools/interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows } from '../graph/tools'
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
  
  // Graph Tools
  queryGraph: typeof queryGraph
  updateGraph: typeof updateGraph
  getTestCoverage: typeof getTestCoverage
  getAttackPath: typeof getAttackPath
  getUntestedActions: typeof getUntestedActions
  getAuthFlows: typeof getAuthFlows
  
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
}

// Centralized tool registry with consistent IDs
export function createToolRegistry(logger?: Logger): ToolRegistry {
  const log = logger || new Logger('ToolRegistry')
  
  log.info('Creating centralized tool registry')
  
  return {
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
    
    // Graph Tools
    queryGraph,
    updateGraph,
    getTestCoverage,
    getAttackPath,
    getUntestedActions,
    getAuthFlows,
    
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
  }
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
] as const

export type ToolId = typeof TOOL_IDS[number]

// Tool metadata for documentation and validation
export const TOOL_METADATA: Record<ToolId, {
  id: string
  description: string
  category: 'http' | 'observation' | 'session' | 'control' | 'graph' | 'app-model' | 'recon' | 'interaction' | 'oast'
  inputSchema: any
  outputSchema: any
}> = {
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
    description: 'Query graph nodes and edges',
    category: 'graph',
    inputSchema: z.object({
      nodeType: z.string().optional().describe('Filter by node type'),
      filters: z.record(z.string(), z.unknown()).optional().describe('Additional filters'),
      includeEdges: z.boolean().default(false).describe('Include related edges'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          type: z.string(),
          label: z.string(),
          properties: z.record(z.unknown()),
          createdAt: z.number(),
          updatedAt: z.number(),
        })),
        edges: z.array(z.object({
          id: z.string(),
          fromId: z.string(),
          toId: z.string(),
          type: z.string(),
          properties: z.record(z.unknown()),
          createdAt: z.number(),
        })).optional(),
      }),
    }),
  },
  updateGraph: {
    id: 'updateGraph',
    description: 'Update graph node properties',
    category: 'graph',
    inputSchema: z.object({
      nodeId: z.string().describe('Node ID to update'),
      properties: z.record(z.unknown()).describe('Properties to update'),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      value: z.object({
        updated: z.boolean(),
        nodeId: z.string(),
        properties: z.record(z.unknown()),
      }),
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
          properties: z.record(z.unknown()),
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
          properties: z.record(z.unknown()),
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
          properties: z.record(z.unknown()),
        })),
        count: z.number(),
      }),
    }),
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
        header: z.record(z.unknown()),
        payload: z.record(z.unknown()),
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
export function getToolsByCategory(category: ToolMetadata['category']): ToolId[] {
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
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
}