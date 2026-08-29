/**
 * String Constants - Centralized String Constants
 * 
 * All commonly used string constants, environment values, and enum-like values.
 */

// ========== Environment Values ==========
export const ENVIRONMENTS = {
  LOCAL: 'LOCAL' as const,
  DEVELOPMENT: 'DEVELOPMENT' as const,
  DEV: 'DEV' as const,
  STAGING: 'STAGING' as const,
  PRODUCTION: 'PRODUCTION' as const,
  PROD: 'PROD' as const,
  TEST: 'TEST' as const,
  CI: 'CI' as const,
} as const

// ========== Browser Providers ==========
export const BROWSER_PROVIDERS = {
  STAGEHAND: 'stagehand' as const,
  CAMOUFOX: 'camofox' as const,
  PLAYWRIGHT: 'playwright' as const,
  PUPPETEER: 'puppeteer' as const,
} as const

// ========== Engine Types ==========
export const ENGINE_TYPES = {
  MULTI_MODEL: 'multi-model' as const,
  LEGACY: 'legacy' as const,
  SOLVER: 'solver' as const,
  COUNCIL: 'council' as const,
} as const

// ========== Engine Tiers ==========
export const ENGINE_TIERS = {
  FAST: 'fast' as const,
  BALANCED: 'balanced' as const,
  POWERFUL: 'powerful' as const,
} as const

// ========== Log Levels ==========
export const LOG_LEVELS = {
  DEBUG: 'debug' as const,
  INFO: 'info' as const,
  WARN: 'warn' as const,
  ERROR: 'error' as const,
  SUCCESS: 'success' as const,
  DIM: 'dim' as const,
  VERBOSE: 'verbose' as const,
  SILENT: 'silent' as const,
} as const

// ========== Scope Modes ==========
export const SCOPE_MODES = {
  CLAIM_BASED: 'claim-based' as const,
  ALLOW_ALL: 'allow-all' as const,
  DENY_ALL: 'deny-all' as const,
} as const

// ========== Interaction Modes ==========
export const INTERACTION_MODES = {
  ASK: 'ask' as const,
  RUN: 'run' as const,
} as const

// ========== Log Types ==========
export const LOG_TYPES = {
  INFO: 'info' as const,
  WARN: 'warn' as const,
  ERROR: 'error' as const,
  DEBUG: 'debug' as const,
  SUCCESS: 'success' as const,
  DIM: 'dim' as const,
} as const

// ========== Scope Types ==========
export const SCOPE_TYPES = {
  CLAIM_BASED: 'claim-based' as const,
  ALLOW_ALL: 'allow-all' as const,
  DENY_ALL: 'deny-all' as const,
} as const

// ========== Session Statuses ==========
export const SESSION_STATUSES = {
  PENDING: 'pending' as const,
  ACTIVE: 'active' as const,
  COMPLETED: 'completed' as const,
  FAILED: 'failed' as const,
  ABORTED: 'aborted' as const,
  PAUSED: 'paused' as const,
} as const

// ========== Task Statuses ==========
export const TASK_STATUSES = {
  PENDING: 'pending' as const,
  RUNNING: 'running' as const,
  COMPLETED: 'completed' as const,
  FAILED: 'failed' as const,
  CANCELLED: 'cancelled' as const,
  RETRYING: 'retrying' as const,
  QUEUED: 'queued' as const,
} as const

// ========== Finding Statuses ==========
export const FINDING_STATUSES = {
  CANDIDATE: 'candidate' as const,
  CONFIRMED: 'confirmed' as const,
  REJECTED: 'rejected' as const,
  FALSE_POSITIVE: 'false-positive' as const,
  DUPLICATE: 'duplicate' as const,
} as const

// ========== Vulnerability Types ==========
export const VULNERABILITY_TYPES = {
  SQL_INJECTION: 'sql-injection' as const,
  XSS: 'xss' as const,
  CSRF: 'csrf' as const,
  SSRF: 'ssrf' as const,
  IDOR: 'idor' as const,
  RCE: 'rce' as const,
  XXE: 'xxe' as const,
  DESERIALIZATION: 'deserialization' as const,
  COMMAND_INJECTION: 'command-injection' as const,
  PATH_TRAVERSAL: 'path-traversal' as const,
  AUTH_BYPASS: 'auth-bypass' as const,
  PRIVILEGE_ESCALATION: 'privilege-escalation' as const,
  INFORMATION_DISCLOSURE: 'information-disclosure' as const,
  BROKEN_AUTH: 'broken-auth' as const,
  BROKEN_ACCESS_CONTROL: 'broken-access-control' as const,
  SECURITY_MISCONFIGURATION: 'security-misconfiguration' as const,
  VULNERABLE_COMPONENTS: 'vulnerable-components' as const,
  IDENTIFICATION_FAILURES: 'identification-failures' as const,
  SOFTWARE_INTEGRITY: 'software-integrity' as const,
  LOGGING_FAILURES: 'logging-failures' as const,
  CSP_BYPASS: 'csp-bypass' as const,
  CORS_MISCONFIG: 'cors-misconfig' as const,
  OPEN_REDIRECT: 'open-redirect' as const,
  CLICKJACKING: 'clickjacking' as const,
  TEMPLATE_INJECTION: 'template-injection' as const,
  PROTOTYPE_POLLUTION: 'prototype-pollution' as const,
  RACE_CONDITION: 'race-condition' as const,
  BUSINESS_LOGIC: 'business-logic' as const,
} as const

// ========== Severity Levels ==========
export const SEVERITY_LEVELS = {
  CRITICAL: 'critical' as const,
  HIGH: 'high' as const,
  MEDIUM: 'medium' as const,
  LOW: 'low' as const,
  INFO: 'info' as const,
  NONE: 'none' as const,
} as const

// ========== Evidence Types ==========
export const EVIDENCE_TYPES = {
  RAW_RESPONSE: 'raw_response' as const,
  RAW_REQUEST: 'raw_request' as const,
  SCREENSHOT: 'screenshot' as const,
  CONSOLE_LOG: 'console_log' as const,
  NETWORK_LOG: 'network_log' as const,
  DOM_SNAPSHOT: 'dom_snapshot' as const,
  HAR_ENTRY: 'har_entry' as const,
  VIDEO: 'video' as const,
} as const

// ========== Action Types ==========
export const ACTION_TYPES = {
  CLICK: 'click' as const,
  FILL: 'fill' as const,
  CHECK: 'check' as const,
  UNCHECK: 'uncheck' as const,
  PRESS: 'press' as const,
  SCROLL: 'scroll' as const,
  SELECT: 'select' as const,
  HOVER: 'hover' as const,
  DRAG: 'drag' as const,
  DROP: 'drop' as const,
  TYPE: 'type' as const,
  NAVIGATE: 'navigate' as const,
  WAIT: 'wait' as const,
  SCREENSHOT: 'screenshot' as const,
  EXTRACT: 'extract' as const,
  ASSERT: 'assert' as const,
} as const

// ========== Finding Actions ==========
export const FINDING_ACTIONS = {
  CREATE: 'create' as const,
  UPDATE: 'update' as const,
  CONFIRM: 'confirm' as const,
  REJECT: 'reject' as const,
  MERGE: 'merge' as const,
  DUPLICATE: 'duplicate' as const,
  ARCHIVE: 'archive' as const,
  EXPORT: 'export' as const,
} as const

// ========== Export All ==========
export const STRINGS = {
  ENVIRONMENTS,
  BROWSER_PROVIDERS,
  ENGINE_TYPES,
  ENGINE_TIERS,
  LOG_LEVELS,
  SCOPE_MODES,
  INTERACTION_MODES,
  SESSION_STATUSES,
  TASK_STATUSES,
  FINDING_STATUSES,
  VULNERABILITY_TYPES,
  SEVERITY_LEVELS,
  EVIDENCE_TYPES,
  ACTION_TYPES,
  FINDING_ACTIONS,
} as const;
