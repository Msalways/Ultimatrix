/**
 * Limit Constants - Pagination, Rate Limits, Capacity Limits
 * 
 * All pagination limits, rate limits, concurrency limits, and capacity limits.
 */

// ========== Pagination Limits ==========
export const PAGINATION = {
  /** Default page size */
  DEFAULT_PAGE_SIZE: 20,
  
  /** Maximum page size */
  MAX_PAGE_SIZE: 100,
  
  /** Minimum page size */
  MIN_PAGE_SIZE: 1,
  
  /** Maximum total results */
  MAX_TOTAL_RESULTS: 10_000,
  
  /** Default cursor page size */
  CURSOR_PAGE_SIZE: 50,
  
  /** Maximum cursor depth */
  MAX_CURSOR_DEPTH: 1_000,
  
  /** Default offset */
  DEFAULT_OFFSET: 0,
  
  /** Maximum offset */
  MAX_OFFSET: 100_000,
} as const;

// ========== Rate Limits ==========
export const RATE_LIMITS = {
  /** Default requests per minute */
  DEFAULT_RPM: 15,
  
  /** Maximum requests per minute */
  MAX_RPM: 60,
  
  /** Burst allowance */
  BURST: 10,
  
  /** Window size (ms) */
  WINDOW_MS: 60_000,
  
  /** Skip successful requests from rate limit */
  SKIP_SUCCESSFUL: false,
  
  /** Skip failed requests */
  SKIP_FAILED: false,
  
  /** Key generator type */
  KEY_GENERATOR: 'ip' as const,
  
  /** Skip paths */
  SKIP_PATHS: ['/health', '/ready', '/metrics'] as const,
} as const;

// ========== Concurrency Limits ==========
export const CONCURRENCY = {
  /** Maximum concurrent requests */
  MAX_CONCURRENT: 2,
  
  /** Maximum parallel workers */
  MAX_WORKERS: 10,
  
  /** Maximum parallel tasks */
  MAX_PARALLEL: 10,
  
  /** Max concurrent per host */
  MAX_PER_HOST: 6,
  
  /** Semaphore limit */
  SEMAPHORE_LIMIT: 10,
  
  /** Task queue size */
  QUEUE_SIZE: 1000,
} as const;

// ========== Queue Limits ==========
export const QUEUE_LIMITS = {
  /** Maximum queue size */
  MAX_QUEUE_SIZE: 10_000,
  
  /** Maximum pending tasks */
  MAX_PENDING: 1_000,
  
  /** Max workers */
  MAX_WORKERS: 10,
  
  /** High water mark */
  HIGH_WATER: 100,
  
  /** Low water mark */
  LOW_WATER: 10,
  
  /** Task timeout (ms) */
  TASK_TIMEOUT_MS: 300_000,
  
  /** Cleanup interval (ms) */
  CLEANUP_INTERVAL_MS: 60_000,
  
  /** Dead letter queue max */
  DEAD_LETTER_MAX: 1_000,
} as const

// ========== Cache Limits ==========
export const CACHE_LIMITS = {
  /** Maximum cache entries */
  MAX_ENTRIES: 10_000,
  
  /** Maximum cache size (bytes) */
  MAX_SIZE_BYTES: 100 * 1024 * 1024, // 100 MB
  
  /** Default TTL (ms) */
  DEFAULT_TTL_MS: 5 * 60 * 1_000, // 5 minutes
  
  /** Maximum TTL (ms) */
  MAX_TTL_MS: 24 * 60 * 60 * 1_000, // 24 hours
  
  /** Minimum TTL (ms) */
  MIN_TTL_MS: 1_000, // 1 second
  
  /** Cleanup interval (ms) */
  CLEANUP_INTERVAL_MS: 60_000, // 1 minute
  
  /** Maximum key length */
  MAX_KEY_LENGTH: 256,
  
  /** Maximum value size (bytes) */
  MAX_VALUE_SIZE: 10 * 1_024 * 1_024, // 10 MB
} as const

// ========== Search Limits ==========
export const SEARCH_LIMITS = {
  /** Maximum search results */
  MAX_RESULTS: 1_000,
  
  /** Maximum query length */
  MAX_QUERY_LENGTH: 500,
  
  /** Maximum facets */
  MAX_FACETS: 20,
  
  /** Maximum facet values */
  MAX_FACET_VALUES: 100,
  
  /** Maximum highlight fragments */
  MAX_HIGHLIGHTS: 5,
  
  /** Highlight fragment size */
  FRAGMENT_SIZE: 150,
  
  /** Number of fragments */
  FRAGMENTS: 3,
} as const

// ========== Finding & Vulnerability Limits ==========
export const FINDING_LIMITS = {
  /** Maximum findings per engagement */
  MAX_FINDINGS: 1_000,
  
  /** Maximum findings per endpoint */
  MAX_PER_ENDPOINT: 50,
  
  /** Maximum evidence per finding */
  MAX_EVIDENCE_PER_FINDING: 20,
  
  /** Maximum proof steps */
  MAX_PROOF_STEPS: 20,
  
  /** Maximum attack chain length */
  MAX_CHAIN_LENGTH: 10,

  /** Max chain length */
  MAX_CHAIN: 10,
  
  /** Maximum title length */
  MAX_TITLE: 256,
  
  /** Maximum description length */
  MAX_DESCRIPTION: 10_000,
  
  /** Maximum evidence items per finding */
  MAX_EVIDENCE: 20,
} as const

// ========== Graph Limits ==========
export const GRAPH_LIMITS = {
  /** Maximum nodes */
  MAX_NODES: 100_000,
  
  /** Maximum edges */
  MAX_EDGES: 500_000,
  
  /** Maximum traversal depth */
  MAX_DEPTH: 10,
  
  /** Maximum neighborhood size */
  MAX_NEIGHBORHOOD: 1_000,
  
  /** Maximum path length */
  MAX_PATH: 20,
  
  /** Maximum nodes per query */
  MAX_QUERY_NODES: 1_000,
  
  /** Maximum edges per query */
  MAX_QUERY_EDGES: 10_000,
} as const

// ========== Resource Limits ==========
export const RESOURCE_LIMITS = {
  /** Max memory per worker (MB) */
  WORKER_MEMORY_MB: 512,
  
  /** Max CPU per worker (%) */
  MAX_CPU_PERCENT: 80,
  
  /** Max file descriptors */
  MAX_FDS: 1_024,
  
  /** Max open connections */
  MAX_CONNECTIONS: 100,
  
  /** Max pending promises */
  MAX_PENDING_PROMISES: 1_000,
  
  /** Event loop lag threshold (ms) */
  EVENT_LOOP_LAG: 100,
} as const

// ========== Feature Flags ==========
export const FEATURE_FLAGS = {
  /** Enable debug logging */
  DEBUG: false,
  
  /** Enable metrics */
  METRICS: true,
  
  /** Enable tracing */
  TRACING: true,
  
  /** Enable profiling */
  PROFILING: false,
  
  /** Enable experimental features */
  EXPERIMENTAL: false,
  
  /** Strict mode */
  STRICT: true,
  
  /** Verbose logging */
  VERBOSE: false,
} as const

// ========== Export All ==========
export const LIMITS = {
  PAGINATION,
  RATE_LIMITS,
  CONCURRENCY,
  QUEUE_LIMITS,
  CACHE_LIMITS,
  SEARCH_LIMITS,
  FINDING_LIMITS,
  GRAPH_LIMITS,
  RESOURCE_LIMITS,
  FEATURE_FLAGS,
} as const;
