export { startRepl } from './cli/repl';
export { runHunt, parseHuntFlags, type HuntOptions } from './cli/hunt';
export { HuntPrompt, SLASH_HELP, type NodePromptAnswer, type HuntMode } from './cli/prompt';
export { ReportGenerator } from './pipeline/report-generator';
export { AutonomousOrchestrator } from './pipeline/autonomous';
export { providerRegistry, type ProviderConfig, type ProviderFactory, ProviderRegistry } from './providers/provider-registry';
export { toolRegistry } from './tools/tool-registry';
export { readAppModel, writeAppModel, updateAppModelSection, compileReport, type AppModel, DEFAULT_MODEL } from './core/app-model';
export { renderChainFirstReport, renderChainReportHtml, type ChainReportSection } from './core/chain-report';
export { runChainEngine, runLlmChains, type ChainEngineOptions, type ChainEngineResult } from './core/attack-chain';
export { generateFindingTests, writeFindingTests, type FindingTestOptions, type GeneratedTestFile, type GenerationResult } from './tools/finding-test-generator';
export { setLlmConfig, getLlmConfig } from './core/app-model-path';
export { SessionPool, getDefaultSessionPool, resetDefaultSessionPool } from './core/session-pool';
export { WorkflowStateGraph } from './core/workflow-state';
export { AutonomousV3Orchestrator, defaultNodeStrategy, type NodeStrategy, type NodeStrategyResolution } from './pipeline/autonomous-v3';
export { SpiderCrawler, type CrawlResult, type RouteNode } from './explorer/spider';
export { getSharedBrowserManager } from './tools/browser-tools';
export { verifyFindings } from './verification';
export { ingestAll, ingestOpenApi, ingestHar, ingestPostman, ingestSourceCode } from './ingestion';
export { startDashboard } from './dashboard/server';
export { ensureOastRunning, getOastServer, stopOast, OastServer } from './oast';
export { findingsToSarif } from './cli/sarif';
export { Logger, colors } from './cli/logger';
export { StatusDisplay } from './cli/status-display';

// Recon
export { runRecon, runOauthDiscovery, runGraphqlDiscovery, runJwtDiscovery, runFrameworkFingerprint, runCloudMetadataProbe, type ReconOptions, type ReconResult, type ReconLogEntry as ReconLogEntryType } from './recon';

// Advanced attack probes
export { runAllOAuthProbes } from './agents/specialists/oauth';
export { probeRedirectUriPrefixBypass, probeStateMissing, probeScopeEscalation, probeResponseTypeConfusion, probePkceDowngrade, type OAuthProbeConfig, type ProbeResult } from './agents/specialists/oauth-probes';
export { probeCloudMetadata as probeCloudMetadataSpecialist, enumerateS3WithCreds, type CloudProbeConfig, type CloudProbeResult as CloudSpecialistResult } from './agents/specialists/cloud-probes';
export { probeRaceCondition, findRaceCandidates, type RaceProbeConfig, type RaceProbeResult } from './agents/specialists/race-probes';

export {
  selectTechniquesForEndpoint,
  selectTechniquesForForm,
  listAllTechniques,
} from './agents/specialist-builder';
export {
  classifyParamLLM,
  detectBodyFormatLLM,
  detectWafLLM,
  isClickDangerousLLM,
  type ParamCategory,
  type ParamClassification,
  type BodyFormat,
  type BodyFormatDetection,
  type WafName,
  type WafDetection,
  type ClickDangerAssessment,
} from './agents/inference';
export {
  deriveHypothesesWithLLM,
  type HypothesisDerivationMode,
  type DeriveHypothesesWithLLMOptions,
} from './core/attack-plan';

export {
  selectSpecialistsForScan,
  listAllSpecialistNames,
  ALL_SPECIALISTS,
  type SelectionResult,
  type SpecialistFactory,
  type SpecialistToolkit,
} from './agents/specialists';

// v1 primitive catalog + composer
export {
  PRIMITIVE_CATALOG,
  PRIMITIVE_LIST,
  getPrimitive,
  listBrowserPrimitives,
  listDeterministicPrimitives,
  listNonDeterministicPrimitives,
  httpRequest,
  multipartUpload,
  followRedirects,
  craftPayload,
  craftBypass,
  craftXmlEntity,
  craftMultipart,
  injectInContext,
  omitHeader,
  parseResponse,
  evaluateRendered,
  measureTiming,
  compareResponses,
  checkWaf,
  findEndpointsInResponse,
  extractSessionCookie,
  extractCsrfToken,
  useSession,
  spawnSubtask,
  recordEvidence,
  writeFinding,
  type PrimitiveName,
  type PrimitiveDefinition,
  type PrimitiveContext,
  type PrimitiveRequest,
  type PrimitiveResponse,
  type PrimitiveResult,
  type InjectionLocation,
  type PayloadType,
  type WafVendor,
} from './primitives';

export { Composer, type AttackPlan, type ComposerOptions, type ComposerRunResult } from './agents/composer';
export {
  runWafBypass,
  runSecondOrder,
  runChainReasoning,
  type WafBypassInput,
  type WafBypassResult,
  type SecondOrderInput,
  type SecondOrderResult,
  type ChainReasoningInput,
  type ChainReasoningResult,
} from './agents/specialists-composers';

export { LLMClient, getDefaultLLMClient, type LLMCall, type LLMCallResult, type LLMClientConfig } from './llm/client';
