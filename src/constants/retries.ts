/**
 * Retry & Backoff Constants - Centralized Retry Configuration
 * 
 * All retry, backoff, and retry-related configuration in one place.
 */

// ========== Retry Configuration ==========
export const RETRY_CONFIG = {
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  
  /** Base backoff delay (ms) */
  BASE_BACKOFF_MS: 2_000,
  
  /** Maximum backoff delay (ms) */
  MAX_BACKOFF_MS: 30_000,
  
  /** Backoff multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
  
  /** Backoff steps for stepped strategy (ms) */
  BACKOFF_STEPS: [5_000, 15_000, 30_000] as const,
  
  /** Backoff strategy */
  STRATEGY: 'stepped' as const,
  
  /** Use Retry-After header when available */
  USE_HEADERS: true,
  
  /** Retry on rate limit (429) */
  RETRY_ON_429: true,
  
  /** Retry on 5xx server errors */
  RETRY_ON_5XX: true,
  
  /** Retry on network errors */
  RETRY_ON_NETWORK_ERROR: true,
  
  /** Retry on timeout */
  RETRY_ON_TIMEOUT: true,
  
  /** Retry on connection reset */
  RETRY_ON_CONNECTION_RESET: true,

  /** Retry on connection refused */
  RETRY_ON_CONNECTION_REFUSED: true,
  
  /** Retry on DNS failure */
  RETRY_ON_DNS_FAILURE: true,
} as const

// ========== Backoff Strategies ==========
export const BACKOFF_STRATEGIES = {
  /** Exponential backoff */
  EXPONENTIAL: 'exponential' as const,
  
  /** Stepped backoff (fixed steps) */
  STEPPED: 'stepped' as const,
  
  /** Linear backoff */
  LINEAR: 'linear' as const,
  
  /** Constant delay */
  CONSTANT: 'constant' as const,
  
  /** Jittered exponential */
  JITTERED: 'jittered' as const,
} as const

// ========== Backoff Steps ==========
export const BACKOFF_STEPS = {
  /** Default stepped backoff (ms) */
  DEFAULT: [5_000, 15_000, 30_000] as const,
  
  /** Aggressive backoff */
  AGGRESSIVE: [1_000, 5_000, 10_000] as const,
  
  /** Conservative backoff */
  CONSERVATIVE: [10_000, 30_000, 60_000] as const,
  
  /** Very aggressive (for testing) */
  TESTING: [100, 500, 1_000] as const,
  
  /** Very conservative */
  VERY_CONSERVATIVE: [30_000, 60_000, 120_000] as const,
} as const

// ========== Jitter ==========
export const JITTER_CONFIG = {
  /** Enable jitter */
  ENABLED: true,
  
  /** Jitter factor (0-1) */
  FACTOR: 0.2,
  
  /** Jitter type */
  TYPE: 'full' as const, // 'full' | 'decorrelated' | 'equal'
  
  /** Minimum jitter (ms) */
  MIN_MS: 100,
  
  /** Maximum jitter factor */
  MAX_FACTOR: 0.5,
} as const

// ========== Retry Conditions ==========
export const RETRY_CONDITIONS = {
  /** Retry on 429 Too Many Requests */
  ON_429: true,
  
  /** Retry on 5xx server errors */
  ON_5XX: true,
  
  /** Retry on 408 Request Timeout */
  ON_408: true,
  
  /** Retry on network errors */
  ON_NETWORK_ERROR: true,
  
  /** Retry on timeout */
  ON_TIMEOUT: true,
  
  /** Retry on connection reset */
  ON_CONNECTION_RESET: true,
  
  /** Retry on DNS failure */
  ON_DNS_FAILURE: true,
  
  /** Retry on connection refused */
  ON_CONNECTION_REFUSED: true,
} as const

// ========== Non-Retry Conditions ==========
export const NO_RETRY_CONDITIONS = {
  /** Don't retry 4xx client errors (except 429, 408) */
  ON_4XX: false,
  
  /** Don't retry 400 Bad Request */
  ON_400: false,
  
  /** Don't retry 401 Unauthorized */
  ON_401: false,
  
  /** Don't retry 403 Forbidden */
  ON_403: false,
  
  /** Don't retry 404 Not Found */
  ON_404: false,
  
  /** Don't retry 405 Method Not Allowed */
  ON_405: false,
  
  /** Don't retry 409 Conflict */
  ON_409: false,
  
  /** Don't retry 410 Gone */
  ON_410: false,
  
  /** Don't retry 422 Unprocessable Entity */
  ON_422: false,
} as const

// ========== Retry Strategies ==========
export const RETRY_STRATEGIES = {
  /** Exponential backoff */
  EXPONENTIAL: 'exponential' as const,
  
  /** Stepped backoff (fixed steps) */
  STEPPED: 'stepped' as const,
  
  /** Linear backoff */
  LINEAR: 'linear' as const,
  
  /** Constant delay */
  CONSTANT: 'constant' as const,
  
  /** Jittered exponential */
  JITTERED: 'jittered' as const,
  
  /** Decorrelated jitter */
  DECORRELATED: 'decorrelated' as const,
} as const

// ========== Retry Categories ==========
export const RETRY_CATEGORIES = {
  /** Network errors that should trigger retry */
  NETWORK_ERRORS: [
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'EPIPE',
    'ECONNRESET',
    'ECONNABORTED',
  ] as const,
  
  /** HTTP status codes that should trigger retry */
  HTTP_STATUS_CODES: [408, 429, 500, 502, 503, 504] as const,
  
  /** Errors that should NOT be retried */
  DO_NOT_RETRY: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'EPIPE',
    'ECONNRESET',
    'ECONNABORTED',
  ] as const,
} as const

// ========== Circuit Breaker ==========
export const CIRCUIT_BREAKER = {
  /** Failure threshold to open circuit */
  FAILURE_THRESHOLD: 5,
  
  /** Success threshold to close circuit */
  SUCCESS_THRESHOLD: 2,
  
  /** Timeout before trying again (ms) */
  TIMEOUT_MS: 30_000,
  
  /** Monitoring window (ms) */
  WINDOW_MS: 60_000,
  
  /** Minimum requests before evaluating */
  MIN_REQUESTS: 10,
} as const

// ========== Rate Limiting ==========
export const RATE_LIMIT_DEFAULTS = {
  /** Requests per minute */
  REQUESTS_PER_MINUTE: 15,
  
  /** Max concurrent requests */
  MAX_CONCURRENT: 2,
  
  /** Retry on rate limit */
  RETRY_ON_LIMIT: true,
  
  /** Per-host delay (ms) */
  HOST_DELAY_MS: 200,
  
  /** 429 backoff base (ms) */
  RATE_LIMIT_BACKOFF: 1_000,
  
  /** Max 429 retries */
  MAX_429_RETRIES: 3,
} as const

// ========== HTTP Status Codes ==========
export const HTTP_STATUS = {
  // Informational
  CONTINUE: 100,
  SWITCHING_PROTOCOLS: 101,
  PROCESSING: 102,
  EARLY_HINTS: 103,
  
  // Success
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NON_AUTHORITATIVE: 203,
  NO_CONTENT: 204,
  RESET_CONTENT: 205,
  PARTIAL_CONTENT: 206,
  MULTI_STATUS: 207,
  ALREADY_REPORTED: 208,
  IM_USED: 226,
  
  // Redirection
  MULTIPLE_CHOICES: 300,
  MOVED_PERMANENTLY: 301,
  FOUND: 302,
  SEE_OTHER: 303,
  NOT_MODIFIED: 304,
  USE_PROXY: 305,
  TEMPORARY_REDIRECT: 307,
  PERMANENT_REDIRECT: 308,
  
  // Client Error
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  PROXY_AUTH_REQUIRED: 407,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  GONE: 410,
  LENGTH_REQUIRED: 411,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RANGE_NOT_SATISFIABLE: 416,
  EXPECTATION_FAILED: 417,
  IM_A_TEAPOT: 418,
  MISDIRECTED_REQUEST: 421,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 419,
  FAILED_DEPENDENCY: 424,
  TOO_EARLY: 425,
  UPGRADE_REQUIRED: 426,
  PRECONDITION_REQUIRED: 428,
  TOO_MANY_REQUESTS: 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE: 431,
  UNAVAILABLE_FOR_LEGAL_REASONS: 451,
  
  // Server Error
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  HTTP_VERSION_NOT_SUPPORTED: 505,
  VARIANT_ALSO_NEGOTIATES: 506,
  INSUFFICIENT_STORAGE: 507,
  LOOP_DETECTED: 508,
  NOT_EXTENDED: 510,
  NETWORK_AUTHENTICATION_REQUIRED: 511,
} as const

// ========== Export All ==========
export const RETRY_CONSTANTS = {
  CONFIG: RETRY_CONFIG,
  STRATEGIES: RETRY_STRATEGIES,
  BACKOFF_STEPS: BACKOFF_STEPS,
  JITTER: JITTER_CONFIG,
  CONDITIONS: RETRY_CONDITIONS,
  NO_RETRY: NO_RETRY_CONDITIONS,
  STEPS: BACKOFF_STEPS,
  CATEGORIES: RETRY_CATEGORIES,
  CIRCUIT_BREAKER: CIRCUIT_BREAKER,
  RATE_LIMIT: RATE_LIMIT_DEFAULTS,
  HTTP_STATUS: HTTP_STATUS,
} as const
