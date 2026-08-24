/**
 * Ultimatrix SDK — programmatic API for security assessment.
 *
 * Usage:
 *   import { Ultimatrix } from 'ultimatrix'
 *
 *   const scanner = new Ultimatrix({ target: 'https://example.com' })
 *   const analysis = await scanner.learn()
 *   const tests = await scanner.generate()
 *   const report = scanner.exportReport('markdown')
 *   await scanner.close()
 */

export { Ultimatrix } from './sdk'
export type { UltimatrixConfig, ScanResult, ReplayResult, ReplayItem, ReplayStatus } from './sdk'
export { generateCaseFile, validateCaseFile, CASE_FILE_SCHEMA_VERSION } from './report/case-file'
export type { CaseFile, CaseFileValidation } from './report/case-file'
export { buildCiAssessmentResult, ciExitCode, CI_RESULT_SCHEMA_VERSION } from './ci/result'
export type { CiAssessmentResult, CiSeverityThreshold, CiStatus } from './ci/result'
export type { Finding, TestCase } from './generation/test-generator'
export type { AnalysisResult, Pattern, Hypothesis } from './analysis/har-analyzer'
