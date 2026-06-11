import { describe, it, expect } from 'vitest'
import { httpRequest, followRedirects, omitHeader } from './http-tools'
import { injectInContext } from './injection-tools'
import { parseResponse, checkWaf, findEndpointsInResponse, measureTiming } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { registerAllTools, getAttackPath } from './registry'

describe('tool registry', () => {
  it('registerAllTools returns all 26+ tools', () => {
    const tools = registerAllTools()
    const keys = Object.keys(tools)
    expect(keys.length).toBeGreaterThanOrEqual(22)
    expect(keys).toContain('httpRequest')
    expect(keys).toContain('injectInContext')
    expect(keys).toContain('checkWaf')
    expect(keys).toContain('extractSessionCookie')
    expect(keys).toContain('cloudMetadataProbe')
    expect(keys).toContain('getAttackPath')
  })

  it('each tool has id, description, inputSchema', () => {
    const tools = registerAllTools()
    for (const [id, tool] of Object.entries(tools)) {
      expect(tool.id).toBe(id)
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })
})

describe('http tools have correct ids', () => {
  it('httpRequest id is "httpRequest"', () => {
    expect(httpRequest.id).toBe('httpRequest')
  })
  it('followRedirects id is "followRedirects"', () => {
    expect(followRedirects.id).toBe('followRedirects')
  })
  it('omitHeader id is "omitHeader"', () => {
    expect(omitHeader.id).toBe('omitHeader')
  })
})

describe('injection tools have correct ids', () => {
  it('injectInContext id is "injectInContext"', () => {
    expect(injectInContext.id).toBe('injectInContext')
  })
})

describe('observation tools have correct ids', () => {
  it('parseResponse id is "parseResponse"', () => {
    expect(parseResponse.id).toBe('parseResponse')
  })
  it('checkWaf id is "checkWaf"', () => {
    expect(checkWaf.id).toBe('checkWaf')
  })
  it('findEndpointsInResponse id is "findEndpointsInResponse"', () => {
    expect(findEndpointsInResponse.id).toBe('findEndpointsInResponse')
  })
  it('measureTiming id is "measureTiming"', () => {
    expect(measureTiming.id).toBe('measureTiming')
  })
})

describe('session tools have correct ids', () => {
  it('extractSessionCookie id is "extractSessionCookie"', () => {
    expect(extractSessionCookie.id).toBe('extractSessionCookie')
  })
  it('extractCsrfToken id is "extractCsrfToken"', () => {
    expect(extractCsrfToken.id).toBe('extractCsrfToken')
  })
  it('useSession id is "useSession"', () => {
    expect(useSession.id).toBe('useSession')
  })
})

describe('control tools have correct ids', () => {
  it('recordEvidence id is "recordEvidence"', () => {
    expect(recordEvidence.id).toBe('recordEvidence')
  })
  it('writeFinding id is "writeFinding"', () => {
    expect(writeFinding.id).toBe('writeFinding')
  })
})

describe('recon tools have correct ids', () => {
  it('frameworkFingerprint id is "frameworkFingerprint"', () => {
    expect(frameworkFingerprint.id).toBe('frameworkFingerprint')
  })
  it('cloudMetadataProbe id is "cloudMetadataProbe"', () => {
    expect(cloudMetadataProbe.id).toBe('cloudMetadataProbe')
  })
})

describe('app-model tools work via execute', () => {
  it('readAppModelSection returns ok', async () => {
    const result = await (readAppModelSection.execute as any)({ section: 'test' })
    expect(result).toBeDefined()
  })

  it('writeAppModelSection returns ok', async () => {
    const result = await (writeAppModelSection.execute as any)({ section: 'test', data: { x: 1 } })
    expect(result).toBeDefined()
  })
})
