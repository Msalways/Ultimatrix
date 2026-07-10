export { generateReport } from './generator'
export type { ReportOptions } from './generator'

export {
  buildCaseFile,
  writeCaseFile,
  generateCaseFiles,
  caseFileToMarkdown,
} from './case-file'
export type {
  CaseFile,
  AttackPathStep,
  WorkingExploit,
  DecisionLogEntry,
  CaseFileBuildOptions,
  CaseFileWriteOptions,
} from './case-file'
