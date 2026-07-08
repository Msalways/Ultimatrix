import { httpRequest, multipartUpload, followRedirects, omitHeader } from './http-tools'
import { recordTestCase } from './record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams, upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings } from '../graph/tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'
import { getCapturedHeaders, storeSession } from './har-tools'
import { loadSkillReference, searchSkillTool } from './skill-tools'
import { encodeDecode } from './encode-decode'
import { saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow } from './flow-tools'
import { buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus } from './research-tools'

export {
  httpRequest, multipartUpload, followRedirects, omitHeader,
  recordTestCase,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
  extractSessionCookie, extractCsrfToken, useSession,
  recordEvidence, writeFinding,
  queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams,
  upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings,
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
  getCapturedHeaders, storeSession,
  loadSkillReference, searchSkillTool, encodeDecode,
  saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
  buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
}

export function registerAllTools() {
  return {
    httpRequest, multipartUpload, followRedirects, omitHeader,
    recordTestCase,
    parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
    extractSessionCookie, extractCsrfToken, useSession,
    recordEvidence, writeFinding,
    queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams,
    upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings,
    readAppModelSection, writeAppModelSection,
    runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
    askUser,
    getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
    getCapturedHeaders, storeSession,
    loadSkillReference, searchSkills: searchSkillTool, encodeDecode,
    saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
    buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
  }
}
