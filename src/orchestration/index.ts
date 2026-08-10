/**
 * Orchestration layer — Phase 9 (ORCHESTRATION-LAYER-FIX.md).
 *
 * Diagnosis → technique planning → playbook execution. The brain routes on
 * structured graph state (signals/context), never on free text.
 */

export * from './types'
export { diagnoseTargetState, type DiagnosisInput } from './diagnosis'
export { rankTechniqueCandidates, buildAdvancedPlaybook } from './technique-planner'
export { runAdvancedPlaybook, type PlaybookRunInput, type PlaybookRunnerDeps } from './playbook-runner'
export { diagnoseTargetTool, runAdvancedPlaybookTool } from './tools'
