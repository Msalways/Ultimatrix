import { httpRequest, multipartUpload, followRedirects, omitHeader } from './http-tools'
import { recordTestCase } from './record-test-case'
import { parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse } from './observation-tools'
import { extractSessionCookie, extractCsrfToken, useSession } from './session-tools'
import { recordEvidence, writeFinding } from './control-tools'
import { verifyChainsTool } from './detect-chains-tool'
import { queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams, upsertPage, addAction, addInput, addEndpoint, addAuthFlow, addRBACRole, addAttack, chainFindings } from '../graph/tools'
import { readAppModelSection, writeAppModelSection } from './app-model-tools'
import { runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe } from './recon-tools'
import { askUser } from './interaction-tools'
import { getOastUrlTool, checkOastCallbacks, clearOastCallbacks } from '../oast/tools'
import { getCapturedHeaders, storeSession } from './har-tools'
import { listSkills, loadSkillReference, searchSkillTool, loadSkillBodyTool } from './skill-tools'
import { getGraphSchema, getCaptureOverview, queryRelations, getGraphNeighborhood, getWorkflowAround, traceValue, explainReachability, getUntestedWorkarounds } from '../graph/relation-tools'
import { encodeDecode } from './encode-decode'
import { saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow } from './flow-tools'
import { buildResearchMap, planResearchExperiments, compareResearchResponses, evaluateResearchExperiment, recordFindingCandidate, assessCandidateReportability, getResearchStatus } from './research-tools'
import { runPrimitiveTool } from '../primitives'
import { runCampaignTool } from '../campaign/campaign-tool'
import { diagnoseTargetTool } from '../orchestration/tools'
import { recordOutcomeTool } from '../intelligence/outcome-feedback'
import { useCredential } from './credential-tools'
import { dualSessionOrchestrator } from './dual-session'
import { detectMarkerLeak } from './marker-oracle'
import { rawHttpClient } from './raw-http-client'
import { shadowApiDiscovery } from './shadow-discovery'
import { scannerTools } from './scanner-tools'
import { listCapturedRequests, replayCapturedRequest } from './replay-tools'
import { manageSkills } from './skill-manage-tools'
import { webSearch } from './web-search'

export {
  httpRequest, multipartUpload, followRedirects, omitHeader,
  recordTestCase,
  parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse,
  extractSessionCookie, extractCsrfToken, useSession,
  recordEvidence, writeFinding,
  verifyChainsTool,
  queryGraph, updateGraph, getTestCoverage, getAttackPath, getUntestedActions, getAuthFlows, getTargetSummary, getEndpointsWithParams,
  getGraphSchema, getCaptureOverview, queryRelations, getGraphNeighborhood, getWorkflowAround, traceValue, explainReachability, getUntestedWorkarounds,
  upsertPage, addAction, addInput, addEndpoint, addAuthFlow, addRBACRole, addAttack, chainFindings,
  readAppModelSection, writeAppModelSection,
  runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
  askUser,
  getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
  getCapturedHeaders, storeSession,
  loadSkillReference, listSkills, searchSkillTool, loadSkillBodyTool, encodeDecode,
  saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
  buildResearchMap, planResearchExperiments, compareResearchResponses, evaluateResearchExperiment, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
  runPrimitiveTool,
  runCampaignTool,
  diagnoseTargetTool,
  recordOutcomeTool,
  useCredential,
  dualSessionOrchestrator,
  detectMarkerLeak,
  rawHttpClient,
  shadowApiDiscovery,
  scannerTools,
    listCapturedRequests,
    replayCapturedRequest,
    manageSkills,
    webSearch,
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
    getGraphSchema, getCaptureOverview, queryRelations, getGraphNeighborhood, getWorkflowAround, traceValue, explainReachability, getUntestedWorkarounds,
    upsertPage, addAction, addInput, addEndpoint, addAuthFlow, addRBACRole, addAttack, chainFindings,
    readAppModelSection, writeAppModelSection,
    runRecon, graphqlIntrospect, jwtDecode, frameworkFingerprint, cloudMetadataProbe,
    askUser,
    getOastUrlTool, checkOastCallbacks, clearOastCallbacks,
    getCapturedHeaders, storeSession,
    loadSkillReference, listSkills, searchSkills: searchSkillTool, loadSkillBody: loadSkillBodyTool, encodeDecode,
    saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow,
    buildResearchMap, planResearchExperiments, compareResearchResponses, evaluateResearchExperiment, recordFindingCandidate, assessCandidateReportability, getResearchStatus,
    runPrimitive: runPrimitiveTool,
    runCampaign: runCampaignTool,
    diagnoseTarget: diagnoseTargetTool,
    recordOutcome: recordOutcomeTool,
    useCredential,
    dualSessionOrchestrator,
    detectMarkerLeak,
    rawHttpClient,
    shadowApiDiscovery,
    listCapturedRequests,
    replayCapturedRequest,
    manageSkills,
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
