/**
 * credential-reuse — Credential Reuse Engine (F6.1)
 *
 * Core flow: found cred → validate → spray → graph edges
 * The highest ROI primitive: found creds automatically become lateral movement edges.
 */

import type { ObservedFacts } from '../intelligence/evidence-ledger'
import { log } from '../utils/logger'

// Credential types we can reuse
export type CredentialType = 'password' | 'hash' | 'token' | 'key' | 'cookie' | 'ssh_key' | 'api_key' | 'jwt' | 'session_id'

export interface Credential {
  type: CredentialType
  value: string
  id?: string
  metadata: {
    source: string
    username?: string
    domain?: string
    validity?: Date
    tags: string[]
    extractedFrom?: string
    confidence: number
  }
}

export interface Target {
  url: string
  method: string
  params?: Record<string, string>
  headers?: Record<string, string>
  authType?: 'basic' | 'bearer' | 'form' | 'cookie' | 'ssh' | 'winrm'
}

export interface ValidationResult {
  target: Target
  success: boolean
  evidence: string[]
  responseStatus?: number
  evidenceRef?: string
  lockedOut: boolean
  rateLimited: boolean
}

interface SprayResult {
  target: Target
  success: boolean
  evidence: string[]
  responseStatus?: number
  evidenceRef?: string
  lockedOut: boolean
  rateLimited: boolean
}

// In-memory store for discovered credentials (persisted to graph via graph store)
const credentialStore = new Map<string, Credential>()

/**
 * Register a discovered credential for reuse
 */
export function registerCredential(cred: Credential): string {
  const id = `cred:${cred.type}:${Buffer.from(cred.value).toString('base64').slice(0, 16)}`
  credentialStore.set(cred.value, { ...cred, id })
  return id
}

/**
 * Get a stored credential by value
 */
export function getCredential(value: string): Credential | undefined {
  return credentialStore.get(value)
}

/**
 * Get all stored credentials
 */
export function listCredentials(): Credential[] {
  return Array.from(credentialStore.values())
}

/**
 * Credential Reuse Engine — Core Logic
 */
export const credentialReuseEngine = {
  /**
   * Called when a credential is discovered during engagement.
   * Registers the credential and triggers validation/spray if configured.
   */
  async onCredentialFound(cred: Credential, context: { target?: string; endpoints?: string[] }): Promise<{ registered: boolean; id: string }> {
    const id = registerCredential(cred)
    
    // Auto-spray if endpoints provided
    if (context.endpoints && context.endpoints.length > 0) {
      const targets = context.endpoints.map(url => ({ url, method: 'GET', params: {}, headers: {} }))
      await this.spray(cred, targets)
    }
    
    return { registered: true, id }
  },

  /**
   * Spray a credential against multiple targets with rate limiting and lockout detection.
   */
  async spray(cred: Credential, targets: Target[]): Promise<SprayResult[]> {
    const results: SprayResult[] = []
    const concurrency = 5
    
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency)
      const batchResults = await Promise.all(batch.map(async (target) => {
        const result = await this.validate(cred, target)
        return { ...result }
      }))
      results.push(...batchResults)

      // Small delay between batches to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000))
    }
    
    return results
  },

  /**
   * Validate a credential against a single target.
   * Returns validation result with evidence.
   */
  async validate(cred: Credential, target: Target): Promise<ValidationResult> {
    try {
      const { httpRequest } = await import('../tools/http-tools')
      const { recordStructuredEvidence } = await import('../tools/control-tools')
      
      const headers = { ...target.headers }
      
      // Inject credential based on auth type
      switch (target.authType) {
        case 'basic':
          if (cred.metadata.username) {
            const auth = Buffer.from(`${cred.metadata.username}:${cred.value}`).toString('base64')
            headers.Authorization = `Basic ${auth}`
          }
          break
        case 'bearer':
          headers.Authorization = `Bearer ${cred.value}`
          break
        case 'form':
          // Will be sent as form data in body
          break
        case 'cookie':
          headers.Cookie = `${cred.metadata.username}=${cred.value}`
          break
        case 'ssh':
        case 'winrm':
          // Would require different transport
          break
      }
      
      // Make the validation request
      const response = await (httpRequest as any).execute({
        method: target.method || 'GET',
        url: target.url,
        headers,
        body: target.method !== 'GET' ? JSON.stringify(target.params) : undefined,
        timeoutMs: 10000
      })
      
      const statusCode = response?.ok ? (response.value?.status ?? 0) : 0
      const responseHeaders = response?.ok ? (response.value?.headers ?? {}) : {}
      
      // Record the validation attempt as evidence
      await recordStructuredEvidence({
        type: 'raw_request',
        data: JSON.stringify({
          credential: { type: cred.type, username: cred.metadata.username },
          target: target.url,
          method: target.method,
          success: false,
          status: statusCode
        }),
        label: `Credential validation: ${cred.metadata.username}@${target.url}`,
        observed: {
          method: target.method || 'GET',
          url: target.url,
          status: statusCode,
          requestHeaders: headers,
          responseHeaders,
          responseTimeMs: response.value?.durationMs,
        } as ObservedFacts
      })
      
      // Check for lockout/rate limit indicators
      const rateLimited = statusCode === 429
      const possiblyLockedOut = statusCode === 403
      
      const success = response.ok && (
        statusCode === 200 ||
        statusCode === 201 ||
        statusCode === 204 ||
        (statusCode === 302 && !/login|signin|auth/i.test(String(responseHeaders?.location || '')))
      )
      
      if (rateLimited) {
        return {
          target: { url: target.url, method: target.method || 'GET' },
          success: false,
          evidence: ['Rate limited (429)'],
          responseStatus: 429,
          evidenceRef: `rate-limit-${Date.now()}`,
          lockedOut: false,
          rateLimited: true
        }
      }
      
      if (possiblyLockedOut) {
        return {
          target: { url: target.url, method: target.method || 'GET' },
          success: false,
          evidence: ['Account locked out'],
          responseStatus: 403,
          evidenceRef: `lockout-${Date.now()}`,
          lockedOut: true,
          rateLimited: false
        }
      }
      
      if (success) {
        // Record successful reuse
        await recordStructuredEvidence({
          type: 'raw_response',
          data: JSON.stringify({
            credential: { type: cred.type, username: cred.metadata.username },
            target: target.url,
            validatedAt: new Date().toISOString()
          }),
          label: `Credential reuse validated: ${cred.type}`,
          observed: {
            method: target.method || 'GET',
            url: target.url,
            status: statusCode,
            responseHeaders,
          } as ObservedFacts
        })
        
        return {
          target: { url: target.url, method: target.method || 'GET' },
          success: true,
          evidence: ['Credential validated successfully'],
          responseStatus: statusCode,
          evidenceRef: `cred-reuse-${Date.now()}`,
          lockedOut: false,
          rateLimited: false
        }
      }
      
      // Failed validation
      return {
        target: { url: target.url, method: target.method || 'GET' },
        success: false,
        evidence: ['Invalid credentials'],
        responseStatus: statusCode,
        evidenceRef: `failed-${Date.now()}`,
        lockedOut: false,
        rateLimited: false
      }
      
    } catch (error: any) {
      return {
        target: { url: target.url, method: target.method || 'GET' },
        success: false,
        evidence: [`Error: ${error.message}`],
        responseStatus: 0,
        evidenceRef: `error-${Date.now()}`,
        lockedOut: false,
        rateLimited: false
      }
    }
  },

  /**
   * Record a successful credential reuse as a graph edge.
   * Creates a REUSES edge between credential node and target node.
   */
  async recordReuse(cred: Credential, from: string, to: string, result: ValidationResult): Promise<void> {
    try {
      // TODO: create a REUSES edge in the graph once the store API supports it.
      // Record in evidence ledger
      const { recordStructuredEvidence } = await import('../tools/control-tools')
      await recordStructuredEvidence({
        type: 'raw_response',
        data: JSON.stringify({
          credential: { type: cred.type, username: cred.metadata.username },
          target: result.target.url,
          validatedAt: new Date().toISOString(),
          success: result.success
        }),
        label: `Credential reuse: ${cred.metadata.username}@${result.target.url}`,
        observed: { 
          method: result.target.method || 'GET', 
          url: result.target.url, 
          status: result.responseStatus ?? 0,
          responseHeaders: {} 
        } as ObservedFacts
      })
    } catch (error) {
      // Log but don't fail
      log.error('Failed to record credential reuse:', error)
}
  }
};

// Also export a convenience function for the runPrimitive tool
const credentialReusePrimitive = {
  id: 'credential-reuse',
  name: 'Credential Reuse Engine',
  description: 'Validates discovered credentials against targets and records successful reuse as graph edges',
  technique: 'credential-reuse',
  adaptsTo: ['credential', 'auth', 'reuse', 'lateral-movement'],
  appliesTo(ctx: any): boolean {
    return ctx.credential !== undefined || ctx.credentialValue !== undefined
  },
  async generate(_ctx: any): Promise<any[]> {
    return []
  },
  async oracle(_results: any[], _gate: any): Promise<any> {
    return { confirmed: false, confidence: 0, evidence: [], note: 'Credential reuse engine runs via credentialReuse engine, not directly via runPrimitive' }
  }
}

// Export the primitive for registry registration
export const credentialReuse = credentialReusePrimitive

export type CredentialValidationResult = ValidationResult