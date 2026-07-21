import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getConfig } from '../config'
import { getActivePage } from '../browser/manager'
import { maskSecret } from '../capture/har-parser'
import { log } from '../utils/logger'

/**
 * Credential tool — the ONLY sanctioned path for the agent to use user-supplied
 * test accounts. Plaintext passwords are NEVER echoed into model-facing text or
 * the prompt (see P0-01). Instead:
 *   - `list`  → returns available role names only (no secrets).
 *   - `reveal`→ returns the login identifier (email) + a MASKED password so the
 *               agent can identify the account without ever seeing the secret.
 *   - `login` → performs the login form-fill out-of-band via the active browser
 *               page. The real password is read from config at execution time and
 *               handed straight to the browser automation layer; only a masked
 *               confirmation is returned to the model.
 */
export const useCredential = createTool({
  id: 'useCredential',
  description:
    'Use a user-supplied test account by ROLE (never by typing a password yourself). ' +
    "action='list' lists available roles; action='reveal' returns the account email and a MASKED password; " +
    "action='login' fills and submits the login form in the live browser using the stored credential for that role. " +
    'Passwords are never returned in plaintext — the tool injects them into the browser directly.',
  inputSchema: z.object({
    action: z.enum(['list', 'reveal', 'login']),
    role: z.string().optional().describe('The credential role, e.g. "admin" or "user". Required for reveal/login.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    roles: z.array(z.string()).optional(),
    email: z.string().optional(),
    maskedPassword: z.string().optional(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const { action, role } = context as { action: 'list' | 'reveal' | 'login'; role?: string }
    const credentials = getConfig().credentials ?? {}
    const roles = Object.keys(credentials)

    if (action === 'list') {
      return {
        ok: roles.length > 0,
        roles,
        message: roles.length > 0
          ? `Available credential roles: ${roles.join(', ')}`
          : 'No credentials configured for this engagement.',
      }
    }

    if (!role) {
      return { ok: false, message: `action='${action}' requires a "role". Available: ${roles.join(', ') || '(none)'}` }
    }

    const cred = credentials[role]
    if (!cred) {
      return { ok: false, roles, message: `No credential for role "${role}". Available: ${roles.join(', ') || '(none)'}` }
    }

    if (action === 'reveal') {
      return {
        ok: true,
        email: cred.email,
        maskedPassword: maskSecret(cred.password),
        message: `Role "${role}" identifier is ${cred.email}. Password is redacted — use action='login' to authenticate.`,
      }
    }

    const page = getActivePage()
    if (!page) {
      return { ok: false, message: 'No active browser page — navigate to the login page before calling login.' }
    }

    try {
      await page.act(`Type "${cred.email}" into the email or username field`)
      await page.act(`Type "${cred.password}" into the password field`)
      await page.act('Click the login or sign in button')
      log.info(`[useCredential] Logged in as role "${role}" (${cred.email})`)
      return {
        ok: true,
        email: cred.email,
        maskedPassword: maskSecret(cred.password),
        message: `Submitted login for role "${role}" (${cred.email}). Verify the resulting page/session state.`,
      }
    } catch (err) {
      return {
        ok: false,
        email: cred.email,
        message: `Login attempt for role "${role}" failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
