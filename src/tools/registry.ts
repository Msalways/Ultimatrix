import { httpRequest, multipartUpload, followRedirects, omitHeader } from './http-tools'
import { recordTestCase } from './record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { verifyChainsTool } from './detect-chains-tool'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams, upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings } from '../graph/tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'
import { getCapturedHeaders, storeSession } from './har-tools'
import { listSkills, loadSkillReference, searchSkillTool } from './skill-tools'
import { encodeDecode } from './encode-decode'
import { saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow } from './flow-tools'
import { buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus } from './research-tools'
import { runPrimitiveTool } from '../primitives'
import { runCampaignTool } from '../campaign/campaign-tool'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import { useCredential } from './credential-tools'
import { dualSessionOrchestrator } from './dual-session'
import { detectMarkerLeak } from './marker-oracle'
import { rawHttpClient } from './raw-http-client'
import { shadowApiDiscovery } from './shadow-discovery'
import { scannerTools } from './scanner-tools'

export {
  httpRequest, multipartUpload, followRedirects, omitHeader,
  recordTestCase,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
  extractSessionCookie, extractCsrfToken, useSession,
  recordEvidence, writeFinding,
  verifyChainsTool,
  queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams,
  upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings,
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
  getCapturedHeaders, storeSession,
  loadSkillReference, listSkills, searchSkillTool, encodeDecode,
  saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
  buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
  runPrimitiveTool,
  runCampaignTool,
  recordOutcomeTool,
  useCredential,
  dualSessionOrchestrator,
  detectMarkerLeak,
  rawHttpClient,
  shadowApiDiscovery,
  scannerTools,
}

export function registerAllTools() {
  return {
    httpRequest, multipartUpload, followRedirects, omitHeader,
    recordTestCase,
    parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
    extractSessionCookie, extractCsrfToken, useSession,
    recordEvidence, writeFinding,
    verifyChains: verifyChainsTool,
    queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams,
    upsertPage, addAction, addInput, addEndpoint, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings,
    readAppModelSection, writeAppModelSection,
    runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
    askUser,
    getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
    getCapturedHeaders, storeSession,
    loadSkillReference, listSkills, searchSkills: searchSkillTool, encodeDecode,
    saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
    buildResearchMap, planResearchExperiments, compareResearchResponses, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
    runPrimitive: runPrimitiveTool,
    runCampaign: runCampaignTool,
    recordOutcome: recordOutcomeTool,
    useCredential,
    dualSessionOrchestrator,
    detectMarkerLeak,
    rawHttpClient,
    shadowApiDiscovery,
    nuclei: scannerTools.nuclei,
    sqlmap: scannerTools.sqlmap,
    ffuf: scannerTools.ffuf,
    nmap: scannerTools.nmap,
    jwttool: scannerTools.jwttool,
    arjun: scannerTools.arjun,
    corsy: scannerTools.corsy,
    subfinder: scannerTools.subfinder,
    gitleaks: scannerTools.gitleaks,
  }
}
