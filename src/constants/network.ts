/**
 * Network Constants - Centralized Network Configuration
 * 
 * All network-related constants including timeouts, retries, limits,
 * and protocol-specific values.
 */

// ========== HTTP Timeouts ==========
export const HTTP_TIMEOUTS = {
  /** Default request timeout (ms) */
  REQUEST: 30_000,
  
  /** Long-running request timeout (ms) */
  LONG_REQUEST: 60_000,
  
  /** File upload timeout (ms) */
  UPLOAD: 120_000,
  
  /** File download timeout (ms) */
  DOWNLOAD: 120_000,
  
  /** Connection timeout (ms) */
  CONNECT: 10_000,
  
  /** TLS handshake timeout (ms) */
  TLS_HANDSHAKE: 10_000,
  
  /** Response header timeout (ms) */
  RESPONSE_HEADER: 10_000,
  
  /** Idle connection timeout (ms) */
  IDLE: 60_000,
  
  /** Keep-alive timeout (ms) */
  KEEP_ALIVE: 60_000,
} as const;

// ========== Retry Configuration ==========
export const RETRY_DEFAULTS = {
  /** Maximum retry attempts */
  MAX_RETRIES: 3,
  
  /** Base backoff delay (ms) */
  BASE_BACKOFF_MS: 2_000,
  
  /** Maximum backoff delay (ms) */
  MAX_BACKOFF_MS: 30_000,
  
  /** Backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
  
  /** Backoff steps for stepped strategy (ms) */
  BACKOFF_STEPS: [5_000, 15_000, 30_000] as const,
  
  /** Backoff strategy */
  STRATEGY: 'stepped' as const,
  
  /** Use Retry-After header when available */
  USE_HEADERS: true,
  
  /** Retry on rate limit (429) */
  RETRY_ON_LIMIT: true,
  
  /** Retry on network errors */
  RETRY_ON_NETWORK_ERROR: true,
  
  /** Retry on timeout */
  RETRY_ON_TIMEOUT: true,
  
  /** Retry on 5xx errors */
  RETRY_ON_5XX: true,
  
  /** Retry on 429 (rate limit) */
  RETRY_ON_429: true,
  
  /** Retry on connection reset */
  RETRY_ON_CONNECTION_RESET: true,
} as const;

// ========== Rate Limiting ==========
export const RATE_LIMITS = {
  /** Default requests per minute */
  REQUESTS_PER_MINUTE: 15,
  
  /** Maximum concurrent requests */
  MAX_CONCURRENT: 2,
  
  /** Per-host delay (ms) */
  HOST_DELAY_MS: 200,
  
  /** Requests per second per host */
  PER_HOST_RPS: 5,
  
  /** Burst allowance */
  BURST_ALLOWANCE: 5,
  
  /** Token bucket refill rate (per second) */
  REFILL_RATE: 10,
  
  /** Bucket capacity */
  BUCKET_CAPACITY: 20,
} as const;

// ========== HTTP Limits ==========
export const HTTP_LIMITS = {
  /** Maximum request body size (bytes) */
  MAX_REQUEST_BODY_SIZE: 10 * 1024 * 1024, // 10 MB
  
  /** Maximum response body size (bytes) */
  MAX_RESPONSE_BODY_SIZE: 50 * 1024 * 1024, // 50 MB
  
  /** Maximum header size (bytes) */
  MAX_HEADER_SIZE: 16_384, // 16 KB
  
  /** Maximum headers count */
  MAX_HEADERS_COUNT: 100,
  
  /** Maximum URL length */
  MAX_URL_LENGTH: 8_192,
  
  /** Maximum redirect count */
  MAX_REDIRECTS: 10,
  
  /** Maximum header value length */
  MAX_HEADER_VALUE_LENGTH: 8_192,
  
  /** Maximum cookies per domain */
  MAX_COOKIES_PER_DOMAIN: 300,
  
  /** Maximum cookie size (bytes) */
  MAX_COOKIE_SIZE: 4_096,
} as const;

// ========== Connection Pool ==========
export const CONNECTION_POOL = {
  /** Maximum connections per host */
  MAX_CONNECTIONS_PER_HOST: 6,
  
  /** Maximum total connections */
  MAX_TOTAL_CONNECTIONS: 50,
  
  /** Connection keep-alive (ms) */
  KEEP_ALIVE_MS: 60_000,
  
  /** Connection timeout (ms) */
  CONNECT_TIMEOUT_MS: 10_000,
  
  /** Socket timeout (ms) */
  SOCKET_TIMEOUT_MS: 30_000,
  
  /** Idle connection timeout (ms) */
  IDLE_TIMEOUT_MS: 60_000,
  
  /** Max sockets per host */
  MAX_SOCKETS_PER_HOST: 6,
  
  /** Max free sockets */
  MAX_FREE_SOCKETS: 10,
} as const;

// ========== TLS/SSL ==========
export const TLS_DEFAULTS = {
  /** Minimum TLS version */
  MIN_VERSION: 'TLSv1.2' as const,
  
  /** Reject unauthorized certificates */
  REJECT_UNAUTHORIZED: true,
  
  /** Enable SNI */
  SERVERNAME: true,
  
  /** ALPN protocols */
  ALPN_PROTOCOLS: ['h2', 'http/1.1'] as const,
  
  /** Cipher suites (modern) */
  CIPHERS: [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'TLS_AES_128_GCM_SHA256',
  ] as const,
} as const;

// ========== Proxy ==========
export const PROXY_DEFAULTS = {
  /** Proxy protocol */
  PROTOCOL: 'http' as const,
  
  /** Proxy authentication */
  AUTH: undefined as { username: string; password: string } | undefined,
  
  /** Bypass list */
  BYPASS: ['localhost', '127.0.0.1', '::1'] as const,
  
  /** Proxy for local addresses */
  LOCAL_ADDRESS: false,
} as const;

// ========== DNS ==========
export const DNS_DEFAULTS = {
  /** DNS resolver timeout (ms) */
  TIMEOUT_MS: 5_000,
  
  /** DNS cache TTL (ms) */
  CACHE_TTL_MS: 5 * 60 * 1_000, // 5 minutes
  
  /** DNS over HTTPS */
  DOH: false,
  
  /** DNSSEC validation */
  DNSSEC: false,
} as const;

// ========== WebSocket ==========
export const WEBSOCKET_DEFAULTS = {
  /** Connection timeout (ms) */
  CONNECT_TIMEOUT: 10_000,
  
  /** Ping interval (ms) */
  PING_INTERVAL: 30_000,
  
  /** Pong timeout (ms) */
  PONG_TIMEOUT: 10_000,
  
  /** Max message size (bytes) */
  MAX_MESSAGE_SIZE: 16 * 1024 * 1024, // 16 MB
  
  /** Max frame size (bytes) */
  MAX_FRAME_SIZE: 16 * 1024 * 1024,
  
  /** Per-message deflate */
  PER_MESSAGE_DEFLATE: true,
  
  /** Client tracking */
  CLIENT_TRACKING: true,
} as const;

// ========== Server-Sent Events (SSE) ==========
export const SSE_DEFAULTS = {
  /** Connection timeout (ms) */
  CONNECT_TIMEOUT: 10_000,
  
  /** Reconnect delay (ms) */
  RECONNECT_DELAY: 3_000,
  
  /** Max reconnect attempts */
  MAX_RECONNECT_ATTEMPTS: 10,
  
  /** Reconnect backoff (ms) */
  RECONNECT_BACKOFF: 3_000,
  
  /** Max reconnect delay (ms) */
  MAX_RECONNECT_DELAY: 30_000,
  
  /** Heartbeat interval (ms) */
  HEARTBEAT_INTERVAL: 30_000,
  
  /** Last-Event-ID header */
  LAST_EVENT_ID: true,
} as const;

// ========== Rate Limiting ==========
export const RATE_LIMIT_DEFAULTS = {
  /** Requests per minute per IP */
  RPM: 60,
  
  /** Burst allowance */
  BURST: 10,
  
  /** Window size (ms) */
  WINDOW_MS: 60_000,
  
  /** Skip successful requests */
  SKIP_SUCCESSFUL: false,
  
  /** Skip failed requests */
  SKIP_FAILED: false,
  
  /** Key generator */
  KEY_GENERATOR: 'ip' as const,
  
  /** Skip paths */
  SKIP_PATHS: ['/health', '/ready', '/metrics'] as const,
} as const;

// ========== HTTP Headers ==========
export const HTTP_HEADERS = {
  /** Default content type */
  CONTENT_TYPE: 'application/json',
  
  /** Default accept */
  ACCEPT: 'application/json',
  
  /** User agent */
  USER_AGENT: 'Ultimatrix/8.5.0',
  
  /** Default cache control */
  CACHE_CONTROL: 'no-cache, no-store, must-revalidate',
  
  /** CORS headers */
  CORS: {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
    exposedHeaders: 'Content-Length,Content-Type',
    credentials: true,
    maxAge: 86400,
  } as const,
  
  /** Security headers */
  SECURITY: {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
  } as const,
} as const;

// ========== Export All ==========
export const NETWORK_CONSTANTS = {
  HTTP_TIMEOUTS: HTTP_TIMEOUTS,
  RETRY_DEFAULTS: RETRY_DEFAULTS,
  RATE_LIMITS: RATE_LIMITS,
  HTTP_LIMITS: HTTP_LIMITS,
  CONNECTION_POOL: CONNECTION_POOL,
  TLS_DEFAULTS: TLS_DEFAULTS,
  PROXY_DEFAULTS: PROXY_DEFAULTS,
  DNS_DEFAULTS: DNS_DEFAULTS,
  WEBSOCKET_DEFAULTS: WEBSOCKET_DEFAULTS,
  SSE_DEFAULTS: SSE_DEFAULTS,
  RATE_LIMIT_DEFAULTS: RATE_LIMIT_DEFAULTS,
  HTTP_HEADERS: HTTP_HEADERS,
} as const;