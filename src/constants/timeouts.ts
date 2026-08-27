/**
 * Timeout Constants - Centralized Timeout Configuration
 * 
 * All timeout values in milliseconds. Centralized to avoid magic numbers
 * and make timeout behavior configurable and consistent.
 */

// ========== Browser Timeouts ==========
export const BROWSER_TIMEOUTS = {
  /** Default navigation timeout (ms) */
  NAVIGATION: 30_000,
  
  /** DOM content loaded settle timeout (ms) */
  DOM_SETTLE: 5_000,
  
  /** Default browser launch timeout (ms) */
  LAUNCH: 30_000,
  
  /** Browser context creation timeout (ms) */
  CONTEXT_CREATION: 30_000,
  
  /** Page load timeout (ms) */
  PAGE_LOAD: 30_000,
  
  /** Script execution timeout (ms) */
  SCRIPT: 30_000,
  
  /** Element wait timeout (ms) */
  ELEMENT_WAIT: 5_000,
  
  /** Screenshot capture timeout (ms) */
  SCREENSHOT: 10_000,
} as const;

// ========== Network Timeouts ==========
export const NETWORK_TIMEOUTS = {
  /** Default HTTP request timeout (ms) */
  REQUEST: 30_000,
  
  /** Long-running request timeout (ms) */
  LONG_REQUEST: 60_000,
  
  /** File upload timeout (ms) */
  UPLOAD: 120_000,
  
  /** File download timeout (ms) */
  DOWNLOAD: 120_000,
  
  /** WebSocket connection timeout (ms) */
  WS_CONNECT: 10_000,
  
  /** WebSocket ping interval (ms) */
  WS_PING_INTERVAL: 30_000,
  
  /** SSE connection timeout (ms) */
  SSE_CONNECT: 30_000,
} as const;

// ========== API Timeouts ==========
export const API_TIMEOUTS = {
  /** Default API request timeout (ms) */
  DEFAULT: 30_000,
  
  /** LLM API timeout (ms) */
  LLM: 120_000,
  
  /** Embedding API timeout (ms) */
  EMBEDDING: 60_000,
  
  /** Tool execution timeout (ms) */
  TOOL_EXECUTION: 30_000,
  
  /** Primitive execution timeout (ms) */
  PRIMITIVE: 60_000,
  
  /** Chain execution timeout (ms) */
  CHAIN: 300_000,
  
  /** Crawl timeout (ms) */
  CRAWL: 120_000,
  
  /** Scan timeout (ms) */
  SCAN: 120_000,
} as const;

// ========== Retry & Backoff ==========
export const RETRY_CONFIG = {
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  
  /** Base backoff in milliseconds */
  BASE_BACKOFF_MS: 2_000,
  
  /** Maximum backoff in milliseconds */
  MAX_BACKOFF_MS: 30_000,
  
  /** Backoff steps for stepped strategy (ms) */
  BACKOFF_STEPS: [5_000, 15_000, 30_000] as const,
  
  /** Backoff strategy */
  STRATEGY: 'stepped' as const,
  
  /** Use Retry-After header when available */
  USE_HEADERS: true,
  
  /** Rate limit retry enabled */
  RETRY_ON_LIMIT: true,
  
  /** Requests per minute */
  REQUESTS_PER_MINUTE: 15,
  
  /** Max concurrent requests */
  MAX_CONCURRENT: 2,
  
  /** Host delay (ms) */
  HOST_DELAY_MS: 200,
} as const;

// ========== Polling Intervals ==========
export const POLLING_INTERVALS = {
  /** Short poll interval (ms) */
  SHORT: 1_000,
  
  /** Standard poll interval (ms) */
  STANDARD: 5_000,
  
  /** Long poll interval (ms) */
  LONG: 30_000,
  
  /** Challenge poll interval (ms) */
  CHALLENGE_POLL: 500,
  
  /** SSE reconnect delay (ms) */
  SSE_RECONNECT: 3_000,
  
  /** WebSocket reconnect base delay (ms) */
  WS_RECONNECT_BASE: 3_000,
  
  /** OAST callback check interval (ms) */
  OAST_CHECK: 5_000,
  
  /** Swarm events heartbeat (ms) */
  SWARM_HEARTBEAT: 30_000,
  
  /** Swarm events backoff max (ms) */
  SWARM_BACKOFF_MAX: 30_000,
  
  /** Swarm backoff initial (ms) */
  SWARM_BACKOFF_INITIAL: 3_000,
  
  /** Swarm backoff max (ms) */
  SWARM_BACKOFF_MAX: 30_000,
} as const;

// ========== Browser Specific ==========
export const BROWSER_TIMEOUTS = {
  /** Default navigation timeout (ms) */
  NAVIGATION: 30_000,
  
  /** Page load timeout (ms) */
  PAGE_LOAD: 30_000,
  
  /** DOM content loaded timeout (ms) */
  DOM_CONTENT_LOADED: 30_000,
  
  /** Network idle timeout (ms) */
  NETWORK_IDLE: 5_000,
  
  /** Script execution timeout (ms) */
  SCRIPT: 30_000,
  
  /** Element wait timeout (ms) */
  ELEMENT_WAIT: 5_000,
  
  /** Screenshot timeout (ms) */
  SCREENSHOT: 10_000,
  
  /** Dialog wait timeout (ms) */
  DIALOG_WAIT: 5_000,
  
  /** Download timeout (ms) */
  DOWNLOAD: 60_000,
  
  /** Upload timeout (ms) */
  UPLOAD: 60_000,
} as const;

// ========== Crawler Timeouts ==========
export const CRAWLER_TIMEOUTS = {
  /** Max crawl duration (ms) */
  MAX_DURATION: 120_000,
  
  /** Page load timeout (ms) */
  PAGE_LOAD: 30_000,
  
  /** Link extraction timeout (ms) */
  LINK_EXTRACTION: 10_000,
  
  /** Form detection timeout (ms) */
  FORM_DETECTION: 5_000,
  
  /** Auth detection timeout (ms) */
  AUTH_DETECTION: 5_000,
  
  /** Max pages per crawl */
  MAX_PAGES: 100,
  
  /** Max crawl depth */
  MAX_DEPTH: 2,
} as const;

// ========== Crawler Polling ==========
export const CRAWLER_POLLING = {
  /** Page processing poll interval (ms) */
  PAGE_POLL: 1_000,
  
  /** Link discovery poll (ms) */
  LINK_POLL: 2_000,
  
  /** Form detection poll (ms) */
  FORM_POLL: 2_000,
  
  /** Auth form detection (ms) */
  AUTH_FORM_POLL: 3_000,
  
  /** Challenge resolution poll (ms) */
  CHALLENGE_POLL: 500,
  
  /** Challenge wait max (ms) */
  CHALLENGE_WAIT_MAX: 30_000,
} as const;

// ========== Session & Replay ==========
export const SESSION_TIMEOUTS = {
  /** Session idle timeout (ms) */
  IDLE: 5 * 60 * 1000, // 5 minutes
  
  /** Session absolute timeout (ms) */
  ABSOLUTE: 30 * 60 * 1000, // 30 minutes
  
  /** Replay timeout (ms) */
  REPLAY: 60_000,
  
  /** Session persistence TTL (ms) */
  PERSISTENCE_TTL: 24 * 60 * 60_000, // 24 hours
} as const;

// ========== OAST Timeouts ==========
export const OAST_TIMEOUTS = {
  /** OAST server startup timeout (ms) */
  SERVER_START: 10_000,
  
  /** OAST callback wait (ms) */
  CALLBACK_WAIT: 30_000,
  
  /** OAST poll interval (ms) */
  POLL_INTERVAL: 5_000,
  
  /** OAST max entries */
  MAX_ENTRIES: 1_000,
} as const;

// ========== Utility Functions ==========

/**
 * Get timeout for a specific operation with fallback
 */
export function getTimeout(category: keyof typeof TIMEOUT_CATEGORIES, operation: string, custom?: number): number {
  if (custom !== undefined && custom > 0) return custom;
  
  const categoryTimeouts = TIMEOUT_CATEGORIES[category];
  if (categoryTimeouts && operation in categoryTimeouts) {
    return categoryTimeouts[operation as keyof typeof categoryTimeouts];
  }
  
  return NETWORK_TIMEOUTS.REQUEST;
}

/**
 * All timeout categories for easy access
 */
export const TIMEOUT_CATEGORIES = {
  browser: BROWSER_TIMEOUTS,
  network: NETWORK_TIMEOUTS,
  api: API_TIMEOUTS,
  retry: RETRY_CONFIG,
  polling: POLLING_INTERVALS,
  browserSpecific: BROWSER_TIMEOUTS,
  crawler: CRAWLER_TIMEOUTS,
  crawlerPolling: CRAWLER_POLLING,
  session: SESSION_TIMEOUTS,
  oast: OAST_TIMEOUTS,
} as const;

// Export all as a single namespace
export const TIMEOUTS = {
  browser: BROWSER_TIMEOUTS,
  network: NETWORK_TIMEOUTS,
  api: API_TIMEOUTS,
  retry: RETRY_CONFIG,
  polling: POLLING_INTERVALS,
  browserSpecific: BROWSER_TIMEOUTS,
  crawler: CRAWLER_TIMEOUTS,
  crawlerPolling: CRAWLER_POLLING,
  session: SESSION_TIMEOUTS,
  oast: OAST_TIMEOUTS,
  categories: TIMEOUT_CATEGORIES,
  get: getTimeout,
} as const;