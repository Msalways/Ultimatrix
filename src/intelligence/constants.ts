/**
 * Intelligence Layer — Shared Constants
 *
 * Canonical attack paths and signal lists. Attack paths come from the skill
 * taxonomy — NOT from keyword matching against LLM output. The agent declares
 * what it's doing; we record it. No guessing.
 */

// ── Canonical attack paths (from skill taxonomy) ───────────────────────────

export const ATTACK_PATHS = [
  'sqli',
  'xss',
  'ssrf',
  'rce',
  'ssti',
  'idor',
  'auth_bypass',
  'info_leak',
  'race_condition',
  'file_upload',
  'xxe',
  'deserialization',
  'business_logic',
  'crypto',
  'config',
] as const

export type AttackPath = (typeof ATTACK_PATHS)[number]

// ── Access failure patterns (shared by anti-loop + reflexion) ──────────────

export const FAILED_ACCESS_PATTERNS = [
  'SSLError', 'ReadTimeout', 'ConnectionError', 'TimeoutError',
  'connection_timeout', '502 Bad Gateway', '503', '504',
  'Connection refused', 'Name or service not known', 'No route to host',
]

// ── Anti-loop operational signals ──────────────────────────────────────────
// These are NOT vulnerability-specific. They detect operational states:
// dead ends, meaningful progress, and infrastructure failures.
// They stay stable because "SSLError" is always an SSLError regardless of
// what attack technique is being used.

export const DEAD_END_MARKERS = [
  'does_not_exist', 'does not exist', 'cannot_access', 'cannot access',
  'failed', 'blocked', 'no_injection', 'no injection', 'not_vulnerable',
  'not vulnerable', 'eliminated', 'not_found', 'not found',
  'dead_end', 'dead end', 'walked_here', 'no route',
]

export const MEANINGFUL_PROGRESS = [
  'discovered', 'found', 'confirmed', 'vulnerability', 'endpoint',
  'port', 'service', 'flag', 'success', 'bypass', 'leak',
  'injection', 'xss', 'sqli', 'rce', 'ssrf', 'csrf',
  'accessible', 'open', 'authorized', 'leaked', 'exposed',
]

export const MEANINGFUL_FAILURES = [
  'SSLError', 'ReadTimeout', 'ConnectionError', 'TimeoutError',
  'connection_timeout', '502 Bad Gateway', '503', 'Connection refused',
]

// ── Evidence gate ──────────────────────────────────────────────────────────

export const FLAG_RE = /[A-Za-z_][A-Za-z0-9_]{1,20}\{[^{}\n]{1,200}\}/g

// ── Reflexion escalation hints ─────────────────────────────────────────────

export const ESCALATION_HINTS: Record<number, string[]> = {
  0: ['Try raw payload without encoding first.'],
  1: [
    'URL-encode special characters.',
    'Swap keyword case (SeLeCt, UnIoN).',
    'Try whitespace variants: /**/, newline, tab, %20.',
  ],
  2: [
    'Try double URL-encoding (%25xx).',
    'Insert inline comments: /**/.',
    'Use HTML entity encoding for browser contexts.',
  ],
  3: [
    'Try Unicode escapes: \\u0027.',
    'Try hex encoding: 0x27.',
    'String concatenation: con||cat, UN/**/ION.',
    'Equivalent function substitution.',
  ],
  4: [
    'Combine multi-layer encoding.',
    'Switch to alternative syntax entirely.',
    'Try time-based blind or out-of-band channel.',
    'Switch to a completely different vulnerability class or attack surface.',
  ],
}
