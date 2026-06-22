import { httpRequest, multipartUpload, followRedirects, omitHeader } from './http-tools'
import { recordTestCase } from './record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows } from '../graph/tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'

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

export function registerAllTools() {
  return {
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
}