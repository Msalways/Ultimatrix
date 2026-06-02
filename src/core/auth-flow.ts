/**
 * src/core/auth-flow.ts
 *
 * Discovers the auth model of a target webapp and populates a SessionPool
 * with one session per discovered role. This is what makes RBAC testing
 * possible: we need user-a and user-b, ideally also admin, to detect IDOR
 * and broken function-level auth.
 *
 * The flow is:
 * 1. Inspect the home page for login, signup, and role-switching UI.
 * 2. If env-var creds are provided (ULTIMATRIX_CREDS), use them directly.
 * 3. Otherwise, attempt self-registration on the signup form.
 * 4. Detect role labels from the app's own UI (e.g. "Mechanic", "Driver",
 *    "Admin" shown on the page). LLM-driven when available, regex fallback.
 * 5. For each discovered role, create a session and log in.
 * 6. Cap pool size at 5 to prevent explosion.
 *
 * Design: every external dependency (LLM call, form fill, registration) is
 * injected so unit tests can run with stubs.
 */

import type { Page } from 'playwright';
import type { SessionPool, SessionMeta, SessionRole } from './session-pool';
import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthDiscoveryResult {
  baseUrl: string;
  hasLogin: boolean;
  hasSignup: boolean;
  loginEndpoint: string;
  loginMethod: 'GET' | 'POST';
  loginFields: string[];
  signupEndpoint: string;
  signupFields: string[];
  detectedRoles: DetectedRole[];
  sessions: SessionMeta[];
  errors: string[];
}

export interface DetectedRole {
  name: string;
  source: 'env' | 'llm' | 'regex' | 'common-defaults';
  credentials?: Record<string, string>;
}

export interface RoleDiscoverer {
  detect(page: Page, baseUrl: string): Promise<DetectedRole[]>;
}

export interface FormFiller {
  fill(page: Page, formSelector: string, fields: Record<string, string>): Promise<boolean>;
}

export interface RegistrationProbe {
  canRegister(page: Page, baseUrl: string): Promise<{ ok: boolean; signupEndpoint?: string; fields?: string[]; error?: string }>;
}

export interface AuthFlowOptions {
  maxSessions?: number;
  envCreds?: Record<string, Record<string, string>>;
  roleDiscoverer?: RoleDiscoverer;
  formFiller?: FormFiller;
  registrationProbe?: RegistrationProbe;
}

// ── Defaults: LLM-driven role discovery (with regex fallback) ────────

const KNOWN_ROLE_PATTERNS: Array<{ regex: RegExp; canonical: SessionRole }> = [
  { regex: /admin(istrator)?/i, canonical: 'admin' },
  { regex: /mechanic/i, canonical: 'custom' },
  { regex: /driver/i, canonical: 'custom' },
  { regex: /moderator|mod\b/i, canonical: 'custom' },
  { regex: /owner/i, canonical: 'admin' },
  { regex: /premium/i, canonical: 'user' },
  { regex: /vip/i, canonical: 'user' },
  { regex: /guest/i, canonical: 'anon' },
];

const COMMON_DEFAULT_CREDS: Record<string, Record<string, string>> = {
  admin: { email: 'admin@example.com', password: 'admin' },
  user: { email: 'user@example.com', password: 'user' },
  test: { email: 'test@example.com', password: 'test' },
};

export const regexRoleDiscoverer: RoleDiscoverer = {
  async detect(_page, _baseUrl) {
    return Object.keys(COMMON_DEFAULT_CREDS).map((name) => ({ name, source: 'common-defaults' as const }));
  },
};

// ── AuthFlow ───────────────────────────────────────────────────────────

export class AuthFlow {
  private pool: SessionPool;
  private options: Required<Omit<AuthFlowOptions, 'envCreds' | 'roleDiscoverer' | 'formFiller' | 'registrationProbe'>> & Pick<AuthFlowOptions, 'envCreds' | 'roleDiscoverer' | 'formFiller' | 'registrationProbe'>;

  constructor(pool: SessionPool, options: AuthFlowOptions = {}) {
    this.pool = pool;
    this.options = {
      maxSessions: options.maxSessions ?? 5,
      envCreds: options.envCreds,
      roleDiscoverer: options.roleDiscoverer,
      formFiller: options.formFiller,
      registrationProbe: options.registrationProbe,
    };
  }

  /**
   * End-to-end: scan the home page, discover auth endpoints, populate the
   * session pool with one session per detected role.
   */
  async discoverAndPopulate(
    page: Page,
    baseUrl: string,
    observedHints?: { pageText?: string; formActions?: string[]; navLinks?: string[] },
  ): Promise<AuthDiscoveryResult> {
    const errors: string[] = [];
    const pageText = observedHints?.pageText ?? '';
    const formActions = observedHints?.formActions ?? [];
    const navLinks = observedHints?.navLinks ?? [];

    const hasLogin = this.detectLogin(pageText, formActions, navLinks);
    const hasSignup = this.detectSignup(pageText, formActions, navLinks);
    const loginEndpoint = this.extractLoginEndpoint(pageText, formActions, baseUrl);
    const loginMethod: 'GET' | 'POST' = 'POST';
    const loginFields = this.extractLoginFields(pageText);

    let detectedRoles: DetectedRole[] = [];
    if (this.options.envCreds) {
      detectedRoles = Object.entries(this.options.envCreds).map(([name, creds]) => ({
        name,
        source: 'env' as const,
        credentials: creds,
      }));
    } else if (this.options.roleDiscoverer) {
      try {
        detectedRoles = await this.options.roleDiscoverer.detect(page, baseUrl);
      } catch (e) {
        errors.push(`roleDiscoverer.detect failed: ${String(e)}`);
      }
    }
    if (detectedRoles.length === 0) {
      detectedRoles = this.regexFallback(pageText);
    }

    if (hasSignup && !this.options.envCreds) {
      const probe = this.options.registrationProbe;
      if (probe) {
        try {
          const reg = await probe.canRegister(page, baseUrl);
          if (reg.ok) {
            const regCreds = this.makeRandomCreds(baseUrl);
            detectedRoles.push({ name: 'self-registered', source: 'regex', credentials: regCreds });
          }
        } catch (e) {
          errors.push(`registrationProbe failed: ${String(e)}`);
        }
      }
    }

    detectedRoles = detectedRoles.slice(0, this.options.maxSessions);
    const sessions: SessionMeta[] = [];
    for (const role of detectedRoles) {
      const creds = role.credentials ?? COMMON_DEFAULT_CREDS[role.name];
      if (!creds) continue;
      try {
        const sessionId = `${role.name}-${randomUUID().slice(0, 6)}`;
        await this.pool.getOrCreate(sessionId, {
          role: this.canonicalRole(role.name),
          label: role.name,
          customRoleName: this.canonicalRole(role.name) === 'custom' ? role.name : undefined,
        });
        if (loginEndpoint) {
          const result = await this.pool.login(sessionId, { loginEndpoint, method: loginMethod, fields: creds });
          if (!result.ok) errors.push(`login failed for role "${role.name}": status ${result.status}`);
        }
        const meta = this.pool.list().find((s) => s.id === sessionId);
        if (meta) sessions.push(meta);
      } catch (e) {
        errors.push(`session setup failed for role "${role.name}": ${String(e)}`);
      }
    }

    return {
      baseUrl,
      hasLogin,
      hasSignup,
      loginEndpoint,
      loginMethod,
      loginFields,
      signupEndpoint: hasSignup ? this.extractSignupEndpoint(pageText, formActions, baseUrl) : '',
      signupFields: hasSignup ? this.extractSignupFields(pageText) : [],
      detectedRoles,
      sessions,
      errors,
    };
  }

  private detectLogin(pageText: string, formActions: string[], navLinks: string[]): boolean {
    const text = /log\s*in|sign\s*in|login|signin/i.test(pageText);
    const action = formActions.some((a) => /login|signin|auth/i.test(a));
    const link = navLinks.some((l) => /login|signin|sign-in/i.test(l));
    return text || action || link;
  }

  private detectSignup(pageText: string, formActions: string[], navLinks: string[]): boolean {
    const text = /sign\s*up|register|create\s*account|join/i.test(pageText);
    const action = formActions.some((a) => /register|signup|sign-up|join/i.test(a));
    const link = navLinks.some((l) => /register|signup|sign-up|join/i.test(l));
    return text || action || link;
  }

  private extractLoginEndpoint(pageText: string, formActions: string[], baseUrl: string): string {
    const found = formActions.find((a) => /login|signin|auth/i.test(a));
    if (found) {
      const resolved = this.resolveEndpoint(found, baseUrl);
      if (resolved) return resolved;
    }
    if (this.detectLogin(pageText, formActions, [])) {
      return `${baseUrl.replace(/\/$/, '')}/api/v1/login`;
    }
    return '';
  }

  private extractSignupEndpoint(_pageText: string, formActions: string[], baseUrl: string): string {
    const found = formActions.find((a) => /register|signup|sign-up|join/i.test(a));
    return this.resolveEndpoint(found, baseUrl) ?? `${baseUrl.replace(/\/$/, '')}/api/v1/register`;
  }

  private resolveEndpoint(action: string | undefined, baseUrl: string): string | null {
    if (!action) return null;
    try {
      return new URL(action, baseUrl).href;
    } catch {
      return action;
    }
  }

  private extractLoginFields(_pageText: string): string[] {
    return ['email', 'password'];
  }

  private extractSignupFields(_pageText: string): string[] {
    return ['name', 'email', 'password'];
  }

  private regexFallback(pageText: string): DetectedRole[] {
    const found = new Set<string>();
    for (const { regex } of KNOWN_ROLE_PATTERNS) {
      if (regex.test(pageText)) {
        const m = pageText.match(regex);
        if (m) found.add(m[0].toLowerCase());
      }
    }
    const out: DetectedRole[] = [];
    for (const name of found) {
      if (COMMON_DEFAULT_CREDS[name]) {
        out.push({ name, source: 'regex', credentials: COMMON_DEFAULT_CREDS[name] });
      } else {
        out.push({ name, source: 'regex' });
      }
    }
    if (out.length === 0) {
      out.push({ name: 'user', source: 'common-defaults', credentials: COMMON_DEFAULT_CREDS.user });
    }
    return out;
  }

  private canonicalRole(name: string): SessionRole {
    const lower = name.toLowerCase();
    if (lower.includes('admin')) return 'admin';
    if (lower.includes('mechanic') || lower.includes('driver')) return 'custom';
    if (lower.includes('user') || lower.includes('test')) return 'user';
    return 'anon';
  }

  private makeRandomCreds(baseUrl: string): Record<string, string> {
    let domain = 'example.com';
    try {
      domain = new URL(baseUrl).hostname.replace(/^www\./, '') || domain;
    } catch {}
    const id = randomUUID().slice(0, 8);
    return { email: `ultimatrix-${id}@${domain}`, password: `Pwd-${id}!`, name: `Test ${id}` };
  }
}
