import { getGlobalGraphStore } from '../graph/store'
import type { AuthFlowNode } from '../graph/schema'
import type { AuthFlowType } from '../types/shared'

export interface LoginFormDetection {
  emailField: string
  passwordField: string
  submitSelector: string
  formSelector: string
}

export interface LogoutDetection {
  logoutSelector: string
  buttonText: string
}

export interface TokenRefreshDetection {
  refreshUrl?: string
  refreshTokenParam?: string
  likelyMethod: string
}

const LOGOUT_LINK_REGEX = /<a\s+[^>]*href=["'][^"']*logout[^"']*["'][^>]*>([^<]*)<\/a>/i
const LOGOUT_BUTTON_REGEX = /<button[^>]*>([^<]*logout[^<]*)<\/button>/i
const LOGOUT_TEXT_REGEX = /(<a\s+[^>]*href=["'][^"']*log[-_]?out[^"']*["'][^>]*>[\s\S]*?<\/a>)/i

export function detectLogoutFlow(pageSnapshot: string): LogoutDetection | null {
  const linkMatch = pageSnapshot.match(LOGOUT_LINK_REGEX)
  if (linkMatch) {
    const text = linkMatch[1].trim() || linkMatch[0].match(/href=["']([^"']+)["']/i)?.[1] || 'Logout'
    return {
      logoutSelector: `a:has-text("${text}"), button:has-text("${text}"), [href*="logout"]`,
      buttonText: text,
    }
  }

  const buttonMatch = pageSnapshot.match(LOGOUT_BUTTON_REGEX)
  if (buttonMatch) {
    const text = buttonMatch[1].trim()
    return {
      logoutSelector: `button:has-text("${text}"), a:has-text("${text}"), [href*="logout"]`,
      buttonText: text,
    }
  }

  const textMatch = pageSnapshot.match(LOGOUT_TEXT_REGEX)
  if (textMatch) {
    const innerText = textMatch[1].replace(/<[^>]+>/g, '').trim()
    const href = textMatch[1].match(/href=["']([^"']+)["']/i)?.[1]
    return {
      logoutSelector: `a[href="${href}"], a:has-text("${innerText}")`,
      buttonText: innerText || href || 'Logout',
    }
  }

  const hrefMatch = pageSnapshot.match(/href=["'][^"']*logout[^"']*["']/i)
  if (hrefMatch) {
    const href = hrefMatch[0].replace(/href=["']([^"']+)["']/i, '$1')
    return {
      logoutSelector: `a[href="${href}"]`,
      buttonText: href,
    }
  }

  return null
}

export function detectTokenRefreshFlow(pageSnapshot: string): TokenRefreshDetection | null {
  const refreshPatterns = [
    /refresh.?token/i, /token.?refresh/i,
    /refresh_token/i, /refreshtoken/i,
    /renew.?token/i,
  ]

  for (const pattern of refreshPatterns) {
    if (pattern.test(pageSnapshot)) {
      return {
        refreshUrl: '/auth/refresh',
        refreshTokenParam: 'refresh_token',
        likelyMethod: 'POST',
      }
    }
  }

  const scriptMatch = pageSnapshot.match(/<script[^>]*>[\s\S]*?refresh[\s\S]*?token[\s\S]*?<\/script>/i)
  if (scriptMatch) {
    return {
      refreshUrl: '/api/auth/refresh',
      refreshTokenParam: 'refreshToken',
      likelyMethod: 'POST',
    }
  }

  return null
}

export function detectLoginForm(pageSnapshot: string): LoginFormDetection | null {
  const hasPassword = /type=["']password["']/i.test(pageSnapshot) || /password/i.test(pageSnapshot)
  if (!hasPassword) return null

  const emailMatch = pageSnapshot.match(/name=["']([^"']*email[^"']*)["']/i)
  const emailField = emailMatch ? emailMatch[1] : 'email'
  const passwordMatch = pageSnapshot.match(/name=["']([^"']*password[^"']*)["']/i)
  const passwordField = passwordMatch ? passwordMatch[1] : 'password'

  return {
    emailField,
    passwordField,
    submitSelector: 'button[type="submit"], input[type="submit"]',
    formSelector: 'form',
  }
}

export function createAuthFlow(
  flowType: AuthFlowType,
  steps: Array<{ action: string; url?: string; selector?: string; value?: string }>,
  credentialHash?: string
): AuthFlowNode {
  const store = getGlobalGraphStore()
  const node = store.addAuthFlow({
    flowType,
    steps,
    reusable: true,
    credentialHash,
  })
  store.save()
  return node
}

export function getReusableAuthFlow(): AuthFlowNode | null {
  const store = getGlobalGraphStore()
  const flows = store.getAuthFlows()
  return flows.find(f => f.properties.reusable) || null
}

export async function replayAuthFlow(
  flowId: string,
  executeStep: (step: { action: string; url?: string; selector?: string; value?: string }) => Promise<void>
): Promise<void> {
  const store = getGlobalGraphStore()
  const allFlows = store.getAuthFlows()
  const flow = allFlows.find(f => f.id === flowId)
  if (!flow) throw new Error(`AuthFlow ${flowId} not found`)

  for (const step of flow.properties.steps) {
    await executeStep(step)
  }
}

export function isAuthExpired(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 403
}