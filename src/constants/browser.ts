/**
 * Browser Constants - Centralized Browser Configuration
 * 
 * All browser-related constants centralized to avoid magic numbers
 * and ensure consistent browser behavior across the codebase.
 */

// ========== Viewport Presets ==========
export const VIEWPORT_PRESETS = {
  /** Default desktop viewport */
  DESKTOP: { width: 1_280, height: 720 } as const,
  
  /** Laptop viewport */
  LAPTOP: { width: 1_366, height: 768 } as const,
  
  /** Tablet portrait */
  TABLET_PORTRAIT: { width: 768, height: 1_024 } as const,
  
  /** Tablet landscape */
  TABLET_LANDSCAPE: { width: 1_024, height: 768 } as const,
  
  /** Mobile portrait */
  MOBILE_PORTRAIT: { width: 375, height: 667 } as const,
  
  /** Mobile landscape */
  MOBILE_LANDSCAPE: { width: 667, height: 375 } as const,
  
  /** Full HD */
  FULL_HD: { width: 1_920, height: 1_080 } as const,
  
  /** 4K */
  FOUR_K: { width: 3_840, height: 2_160 } as const,
} as const;

// ========== Default Viewport ==========
export const DEFAULT_VIEWPORT = VIEWPORT_PRESETS.DESKTOP;

// ========== Browser Defaults ==========
export const BROWSER_DEFAULTS = {
  /** Default browser provider */
  PROVIDER: 'stagehand' as const,
  
  /** Headless mode default */
  HEADLESS: true,
  
  /** Default viewport */
  VIEWPORT: { width: 1_280, height: 720 } as const,
  
  /** DOM settle timeout (ms) */
  DOM_SETTLE_TIMEOUT: 5_000,
  
  /** Default environment */
  ENV: 'LOCAL' as const,
  
  /** Self-heal enabled */
  SELF_HEAL: true,
  
  /** Verbosity level */
  VERBOSE: 0,
  
  /** Session scope */
  SESSION_SCOPE: 'workflow' as const,
  
  /** User agent string */
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  
  /** Accept language */
  ACCEPT_LANGUAGE: 'en-US,en;q=0.9',
  
  /** Timezone */
  TIMEZONE: 'UTC',
  
  /** Locale */
  LOCALE: 'en-US',
} as const;

// ========== Browser Provider Types ==========
export const BROWSER_PROVIDERS = {
  STAGEHAND: 'stagehand' as const,
  CAMOUFOX: 'camofox' as const,
} as const;

// ========== Camoufox Specific ==========
export const CAMOUFOX_DEFAULTS = {
  /** Humanize cursor movements */
  HUMANIZE: true,
  
  /** Locale for Camoufox */
  LOCALE: 'en-US',
  
  /** Custom executable path (optional) */
  EXECUTABLE_PATH: undefined as string | undefined,
  
  /** Proxy configuration */
  PROXY: undefined as { server: string; username?: string; password?: string } | undefined,
} as const;

// ========== Viewport Sizes ==========
export const VIEWPORT_SIZES = {
  DESKTOP: VIEWPORT_PRESETS.DESKTOP,
  LAPTOP: VIEWPORT_PRESETS.LAPTOP,
  TABLET: VIEWPORT_PRESETS.TABLET_PORTRAIT,
  MOBILE: VIEWPORT_PRESETS.MOBILE_PORTRAIT,
} as const;

// ========== Browser Events ==========
export const BROWSER_EVENTS = {
  /** Navigation events */
  NAVIGATION: ['domcontentloaded', 'load', 'networkidle'] as const,
  
  /** Interaction events */
  INTERACTION: ['click', 'fill', 'select', 'check', 'uncheck', 'press', 'scroll', 'hover'] as const,
  
  /** Page lifecycle */
  LIFECYCLE: ['load', 'domcontentloaded', 'networkidle'] as const,
} as const;

// ========== Selector Types ==========
export const SELECTOR_TYPES = {
  /** CSS selector */
  CSS: 'css' as const,
  
  /** Text selector */
  TEXT: 'text' as const,
  
  /** XPath selector */
  XPATH: 'xpath' as const,
  
  /** ARIA selector */
  ARIA: 'aria' as const,
  
  /** Role-based selector */
  ROLE: 'role' as const,
} as const;

// ========== Resource Types ==========
export const RESOURCE_TYPES = {
  DOCUMENT: 'document',
  STYLESHEET: 'stylesheet',
  IMAGE: 'image',
  MEDIA: 'media',
  FONT: 'font',
  SCRIPT: 'script',
  TEXTTRACK: 'texttrack',
  XHR: 'xmlhttprequest',
  FETCH: 'fetch',
  EVENTSOURCE: 'eventsource',
  WEBSOCKET: 'websocket',
  MANIFEST: 'manifest',
  OTHER: 'other',
} as const;

// ========== Resource Type Priorities ==========
export const RESOURCE_PRIORITIES = {
  DOCUMENT: 'high' as const,
  SCRIPT: 'high',
  STYLESHEET: 'medium',
  FONT: 'low',
  IMAGE: 'low',
  MEDIA: 'low',
  OTHER: 'low',
} as const;

// ========== Default Wait Options ==========
export const DEFAULT_WAIT_OPTIONS = {
  timeout: 30_000,
  waitUntil: 'networkidle' as const,
  state: 'visible' as const,
} as const;

// ========== Screenshot Options ==========
export const SCREENSHOT_DEFAULTS = {
  fullPage: false,
  type: 'png' as const,
  quality: 90,
  omitBackground: false,
  animations: 'disabled' as const,
} as const;

// ========== Cookie Defaults ==========
export const COOKIE_DEFAULTS = {
  sameSite: 'Lax' as const,
  secure: true,
  httpOnly: true,
} as const;

// ========== Console Log Levels ==========
export const CONSOLE_LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

// ========== Browser Context Options ==========
export const BROWSER_CONTEXT_DEFAULTS = {
  acceptDownloads: true,
  bypassCSP: true,
  ignoreHTTPSErrors: true,
  javaScriptEnabled: true,
  viewport: DEFAULT_VIEWPORT,
  locale: BROWSER_DEFAULTS.LOCALE,
  timezoneId: BROWSER_DEFAULTS.TIMEZONE,
  userAgent: BROWSER_DEFAULTS.USER_AGENT,
  extraHTTPHeaders: {
    'Accept-Language': BROWSER_DEFAULTS.ACCEPT_LANGUAGE,
  },
} as const;

// ========== Export All ==========
export const BROWSER_CONSTANTS = {
  VIEWPORT_PRESETS,
  DEFAULT_VIEWPORT,
  BROWSER_DEFAULTS,
  CAMOUFOX_DEFAULTS,
  VIEWPORT_SIZES,
  BROWSER_EVENTS,
  SELECTOR_TYPES,
  RESOURCE_TYPES,
  RESOURCE_PRIORITIES,
  DEFAULT_WAIT_OPTIONS,
  SCREENSHOT_DEFAULTS,
  COOKIE_DEFAULTS,
  CONSOLE_LOG_LEVELS,
  BROWSER_CONTEXT_DEFAULTS,
} as const;