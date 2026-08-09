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
export type { UltimatrixConfig, ScanResult } from './sdk'
export type { Finding, TestCase } from './generation/test-generator'
export type { AnalysisResult, Pattern, Hypothesis } from './analysis/har-analyzer'
