/**
 * Interval Constants - Polling, Heartbeats, and Recurring Intervals
 * 
 * All intervals in milliseconds for consistency.
 */

// ========== Polling Intervals ==========
export const POLLING_INTERVALS = {
  /** Very fast polling (ms) - for real-time updates */
  FAST: 500,
  
  /** Standard polling interval (ms) */
  STANDARD: 5000,
  
  /** Slow polling (ms) - for background tasks */
  SLOW: 30000,
  
  /** Very slow polling (ms) - for maintenance tasks */
  VERY_SLOW: 60000,
  
  /** Very fast polling for real-time updates */
  REALTIME: 100,
  
  /** Slow background polling */
  BACKGROUND: 60000,
} as const

// ========== Heartbeat Intervals ==========
export const HEARTBEAT_INTERVALS = {
  /** Default heartbeat interval (ms) */
  DEFAULT: 30000,
  
  /** Fast heartbeat for critical services */
  FAST: 5000,
  
  /** Slow heartbeat for background services */
  SLOW: 60000,
  
  /** Critical service heartbeat */
  CRITICAL: 5000,
  
  /** Worker heartbeat interval */
  WORKER: 10000,
  
  /** Browser heartbeat */
  BROWSER: 5000,
} as const

// ========== Reconnection Intervals ==========
export const RECONNECT_INTERVALS = {
  /** Initial reconnect delay (ms) */
  INITIAL: 1000,
  
  /** Reconnect base delay (ms) */
  BASE_DELAY: 1000,
  
  /** Maximum reconnect delay (ms) */
  MAX_DELAY: 30000,
  
  /** Reconnect backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
  
  /** Maximum reconnect attempts */
  MAX_ATTEMPTS: 10,
  
  /** Jitter factor (0-1) */
  JITTER_FACTOR: 0.2,
} as const

// ========== Cleanup Intervals ==========
export const CLEANUP_INTERVALS = {
  /** Cache cleanup interval (ms) */
  CACHE_CLEANUP: 60000,
  
  /** Session cleanup interval */
  SESSION_CLEANUP: 5 * 60 * 1000, // 5 minutes
  
  /** Cache entry TTL check */
  CACHE_TTL_CHECK: 60000,
  
  /** Session expiry check */
  SESSION_EXPIRY_CHECK: 60000,
  
  /** Token refresh check */
  TOKEN_REFRESH: 5 * 60 * 1000, // 5 minutes
  
  /** Cache TTL check */
  CACHE_TTL: 60000,
  
  /** Dead letter queue cleanup */
  DEAD_LETTER: 60000,
  
  /** Metrics flush interval */
  METRICS_FLUSH: 10000,

  /** Expired sessions cleanup */
  EXPIRED_SESSIONS: 15 * 60 * 1000, // 15 minutes
  
  /** Expired tokens cleanup */
  EXPIRED_TOKENS: 60 * 60 * 1000, // 1 hour
  
  /** Orphaned resources cleanup */
  ORPHANED_RESOURCES: 60 * 60 * 1000, // 1 hour
  
  /** Log cleanup */
  LOGS: 24 * 60 * 60 * 1000, // 24 hours
  
  /** Metrics cleanup */
  METRICS: 60 * 60 * 1000, // 1 hour
  
  /** Temporary files cleanup */
  TEMP_FILES: 60 * 60 * 1000, // 1 hour
  
  /** Cache cleanup */
  CACHE: 5 * 60 * 1000, // 5 minutes
  
  /** Session cleanup */
  SESSIONS: 5 * 60 * 1000, // 5 minutes
} as const

// ========== Cleanup TTLs ==========
export const CLEANUP_TTLS = {
  /** Session expiry (ms) */
  SESSION_EXPIRY: 30 * 60 * 1000, // 30 minutes
  
  /** Cache entry TTL */
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
  
  /** Token TTL */
  TOKEN_TTL: 60 * 60 * 1000, // 1 hour
  
  /** Session cookie max age */
  COOKIE_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
  
  /** Token refresh threshold */
  TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000, // 5 minutes
  
  /** Refresh token TTL */
  REFRESH_TOKEN_TTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  
  /** Access token TTL */
  ACCESS_TOKEN_TTL: 15 * 60 * 1000, // 15 minutes
} as const

// ========== Cache Intervals ==========
export const CACHE_INTERVALS = {
  /** Default cache TTL */
  DEFAULT_TTL: 5 * 60 * 1000, // 5 minutes
  
  /** Short TTL */
  SHORT_TTL: 60000, // 1 minute
  
  /** Medium TTL */
  MEDIUM_TTL: 5 * 60 * 1000, // 5 minutes
  
  /** Long TTL */
  LONG_TTL: 60 * 60 * 1000, // 1 hour
  
  /** Very long TTL */
  VERY_LONG_TTL: 24 * 60 * 60 * 1000, // 24 hours
  
  /** Permanent (no expiry) */
  PERMANENT: -1,
} as const

// ========== Refresh Intervals ==========
export const REFRESH_INTERVALS = {
  /** Access token refresh */
  ACCESS_TOKEN: 15 * 60 * 1000, // 15 minutes
  
  /** Refresh token rotation */
  REFRESH_TOKEN: 7 * 24 * 60 * 60 * 1000, // 7 days
  
  /** Session refresh */
  SESSION: 5 * 60 * 1000, // 5 minutes
  
  /** Token refresh threshold */
  TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000, // 5 minutes
  
  /** Session refresh */
  SESSION_REFRESH: 5 * 60 * 1000, // 5 minutes
} as const

// ========== Metrics & Monitoring ==========
export const METRICS_INTERVALS = {
  /** Metrics collection interval */
  COLLECTION: 10000, // 10 seconds
  
  /** Health check interval */
  HEALTH_CHECK: 30000, // 30 seconds
  
  /** Metrics flush interval */
  FLUSH: 10000, // 10 seconds
  
  /** Metrics aggregation */
  AGGREGATION: 60000, // 1 minute
  
  /** Metrics retention */
  RETENTION: 24 * 60 * 60 * 1000, // 24 hours
  
  /** Detailed metrics retention */
  DETAILED_RETENTION: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const

// ========== Worker Intervals ==========
export const WORKER_INTERVALS = {
  /** Worker heartbeat */
  HEARTBEAT: 10000, // 10 seconds
  
  /** Worker status update */
  STATUS_UPDATE: 5000, // 5 seconds
  
  /** Worker health check */
  HEALTH_CHECK: 30000, // 30 seconds
  
  /** Worker idle timeout */
  IDLE_TIMEOUT: 5 * 60 * 1000, // 5 minutes
  
  /** Worker graceful shutdown timeout */
  SHUTDOWN_TIMEOUT: 30000, // 30 seconds
  
  /** Worker startup timeout */
  STARTUP_TIMEOUT: 60000, // 1 minute
} as const

// ========== Scheduler Intervals ==========
export const SCHEDULER_INTERVALS = {
  /** Cron job minimum interval */
  MIN_CRON_INTERVAL: 60000, // 1 minute
  
  /** Scheduler tick interval */
  TICK: 1000, // 1 second
  
  /** Job cleanup interval */
  JOB_CLEANUP: 60000, // 1 minute
  
  /** Schedule evaluation interval */
  EVALUATION: 5000, // 5 seconds
} as const

// ========== Retry Intervals ==========
export const RETRY_INTERVALS = {
  /** Initial retry delay */
  INITIAL: 1000, // 1 second
  
  /** Base delay */
  BASE_DELAY: 1000,
  
  /** Backoff multiplier */
  MULTIPLIER: 2,
  
  /** Maximum delay cap */
  MAX_DELAY: 30000,
  
  /** Jitter factor (0-1) */
  JITTER: 0.2,
} as const

// ========== Debounce/Throttle ==========
export const DEBOUNCE_THROTTLE = {
  /** Default debounce */
  DEFAULT: 300,
  
  /** Fast debounce */
  FAST: 50,
  
  /** Slow debounce */
  SLOW: 1000,
  
  /** Input debounce */
  INPUT: 300,
  
  /** Search debounce */
  SEARCH: 300,
  
  /** Scroll throttle */
  SCROLL: 100,
  
  /** Resize throttle */
  RESIZE: 250,
} as const

// ========== Animation/Transition ==========
export const ANIMATION = {
  /** Fast transition */
  FAST: 150,
  
  /** Normal transition */
  NORMAL: 300,
  
  /** Slow transition */
  SLOW: 500,
  
  /** CSS fast */
  CSS_FAST: 150,
  
  /** CSS normal */
  CSS_NORMAL: 300,
  
  /** CSS slow */
  CSS_SLOW: 500,
} as const

// ========== Export All ==========
export const INTERVALS = {
  POLLING: POLLING_INTERVALS,
  HEARTBEAT: HEARTBEAT_INTERVALS,
  RECONNECT: RECONNECT_INTERVALS,
  CLEANUP: CLEANUP_INTERVALS,
  CACHE_TTLS: CLEANUP_TTLS,
  CACHE: CACHE_INTERVALS,
  REFRESH: REFRESH_INTERVALS,
  METRICS: METRICS_INTERVALS,
  WORKER: WORKER_INTERVALS,
  SCHEDULER: SCHEDULER_INTERVALS,
  RETRY: RETRY_INTERVALS,
  DEBOUNCE: DEBOUNCE_THROTTLE,
  ANIMATION: ANIMATION,
} as const
