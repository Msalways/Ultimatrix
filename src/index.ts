export { startRepl } from './cli/repl';
export { ReportGenerator } from './pipeline/report-generator';
export { AutonomousOrchestrator } from './pipeline/autonomous';
export { providerRegistry, type ProviderConfig, type ProviderFactory, ProviderRegistry } from './providers/provider-registry';
export { toolRegistry } from './tools/tool-registry';
export { readAppModel, writeAppModel, type AppModel } from './core/app-model';
export { setLlmConfig, getLlmConfig } from './core/app-model-path';
export { verifyFindings } from './verification';
export { SpiderCrawler } from './explorer/spider';
export { ingestAll, ingestOpenApi, ingestHar, ingestPostman, ingestSourceCode } from './ingestion';
export { startDashboard } from './dashboard/server';
export { ensureOastRunning, getOastServer, stopOast, OastServer } from './oast';
export { findingsToSarif } from './cli/sarif';
export { Logger, colors } from './cli/logger';
export { StatusDisplay } from './cli/status-display';

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
