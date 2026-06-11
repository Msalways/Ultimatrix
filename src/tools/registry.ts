import { httpRequest, multipartUpload, followRedirects, omitHeader } from './http-tools'
import { injectInContext } from './injection-tools'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows } from '../graph/tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { stagehandAct, stagehandExtract, stagehandAgent } from './stagehand-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'

export {
  httpRequest, multipartUpload, followRedirects, omitHeader,
  injectInContext,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
  extractSessionCookie, extractCsrfToken, useSession,
  recordEvidence, writeFinding,
  queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows,
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  stagehandAct, stagehandExtract, stagehandAgent,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
}

export function registerAllTools() {
  return {
    httpRequest, multipartUpload, followRedirects, omitHeader,
    injectInContext,
    parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
    extractSessionCookie, extractCsrfToken, useSession,
    recordEvidence, writeFinding,
    queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows,
    readAppModelSection, writeAppModelSection,
    runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
    askUser,
    stagehandAct, stagehandExtract, stagehandAgent,
    getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
  }
}