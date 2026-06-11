import type { Page } from 'playwright'

export interface DiscoveredForm {
  selector: string
  fields: Array<{ selector: string; type: string; name: string; placeholder: string; required: boolean }>
  action: string
  method: string
}

export interface DiscoveredRoute {
  url: string
  method: string
  contentType: string
  status: number
  bodyPreview: string
  params: string[]
  requiresAuth: boolean
}

const OVERLAY_SELECTORS = [
  'button:has-text("Accept")',
  'button:has-text("OK")',
  'button:has-text("Got it")',
  'button:has-text("Agree")',
  'button:has-text("Close")',
  'button:has-text("Dismiss")',
  'button:has-text("I understand")',
  'button:has-text("Continue")',
  'button:has-text("Allow")',
  'button:has-text("Reject all")',
  'button:has-text("Decline")',
  '[aria-label="Close"]',
  '[aria-label="Dismiss"]',
  '[data-dismiss]',
  '[data-bs-dismiss]',
  '.close',
  '.modal-close',
  '.cookie-close',
  '.overlay-close',
]

export async function dismissOverlays(page: Page): Promise<string[]> {
  const dismissed: string[] = []
  try {
    for (const sel of OVERLAY_SELECTORS) {
      try {
        const els = await page.locator(sel).all()
        for (const el of els) {
          if (await el.isVisible()) {
            await el.click({ timeout: 1000 })
            dismissed.push(sel)
          }
        }
      } catch {
        // continue
      }
    }

    const dialogs = await page.locator('[role="dialog"], [role="alertdialog"], .modal, .overlay').all()
    for (const dialog of dialogs) {
      if (await dialog.isVisible()) {
        try {
          const closeBtn = dialog.locator('button:has-text("Close"), button:has-text("OK"), [aria-label="Close"], .close')
          if (await closeBtn.isVisible()) {
            await closeBtn.click({ timeout: 1000 })
            dismissed.push('dialog-close')
          }
        } catch {
          try {
            await page.keyboard.press('Escape')
            dismissed.push('escape')
          } catch { /* ignore */ }
        }
      }
    }

    try {
      const cookieBanner = page.locator('[id*="cookie"], [class*="cookie"], [class*="consent"]').first()
      if (await cookieBanner.isVisible()) {
        const acceptBtn = cookieBanner.locator('button:has-text("Accept"), a:has-text("Accept")')
        if (await acceptBtn.isVisible()) {
          await acceptBtn.click({ timeout: 1000 })
          dismissed.push('cookie-accept')
        }
      }
    } catch { /* ignore */ }
  } catch { /* ignore */ }

  return [...new Set(dismissed)]
}

export async function exploreFormsOnPage(page: Page): Promise<DiscoveredForm[]> {
  const forms: DiscoveredForm[] = []
  try {
    const formEls = await page.locator('form').all()
    for (const form of formEls) {
      try {
        const action = (await form.getAttribute('action')) || ''
        const method = ((await form.getAttribute('method')) || 'get').toUpperCase()
        const selector = (await form.evaluate((el: Element) => {
          if (el.id) return `#${el.id}`
          if (el.className && typeof el.className === 'string') return `form.${el.className.split(' ').filter(Boolean).join('.')}`
          const parent = el.parentElement
          const siblings = parent ? Array.from(parent.querySelectorAll('form')) : [el]
          return `form:nth-of-type(${siblings.indexOf(el) + 1})`
        })) || 'form'

        const fieldEls = await form.locator('input, select, textarea').all()
        const fields: DiscoveredForm['fields'] = []

        for (const field of fieldEls) {
          try {
            const fieldType = await field.evaluate((el: Element) =>
              el.tagName.toLowerCase() === 'select' ? 'select'
                : el.tagName.toLowerCase() === 'textarea' ? 'textarea'
                  : (el as HTMLInputElement).type || 'text')
            const name = (await field.getAttribute('name')) || ''
            const placeholder = (await field.getAttribute('placeholder')) || ''
            const requiredAttr = (await field.getAttribute('required')) !== null
            const fieldSelector = await field.evaluate((el: Element) => {
              if (el.id) return `#${el.id}`
              const n = el.getAttribute('name')
              if (n) return `[name="${n}"]`
              return el.tagName.toLowerCase()
            })

            fields.push({
              selector: fieldSelector,
              type: fieldType,
              name,
              placeholder,
              required: requiredAttr,
            })
          } catch { /* skip field */ }
        }

        forms.push({ selector, fields, action, method })
      } catch { /* skip form */ }
    }
  } catch { /* ignore */ }

  return forms
}

const INTERACTIVE_SELECTORS = [
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="toggle"]',
  '[role="switch"]',
  '.accordion-toggle',
  '.dropdown-toggle',
  '.navbar-toggle',
  '[data-toggle]',
  '[data-tab]',
]

export async function clickInteractiveElements(page: Page): Promise<string[]> {
  const clicked: string[] = []
  try {
    for (const sel of INTERACTIVE_SELECTORS) {
      try {
        const els = await page.locator(sel).all()
        for (const el of els) {
          try {
            if (await el.isVisible()) {
              const text = await el.textContent()
              const tagName = await el.evaluate((node: Element) => node.tagName.toLowerCase())
              if (text && ['accept', 'ok', 'got it', 'agree', 'close', 'dismiss'].includes(text.trim().toLowerCase())) {
                continue
              }
              await el.click({ timeout: 1000 })
              clicked.push(`${tagName}: "${(text || '').trim().slice(0, 40)}"`)
            }
          } catch { /* skip element */ }
        }
      } catch { /* skip selector */ }
    }
  } catch { /* ignore */ }

  return clicked
}

export async function extractHashRoutes(page: Page): Promise<string[]> {
  const routes: string[] = []
  try {
    const links = await page.locator('a[href^="#/"]').all()
    for (const link of links) {
      try {
        const href = await link.getAttribute('href')
        if (href && !routes.includes(href)) {
          routes.push(href)
        }
      } catch { /* skip link */ }
    }
  } catch { /* ignore */ }
  return routes
}

export async function fillAndSubmitForm(
  page: Page,
  formSelector: string,
  fieldValues: Record<string, string>,
): Promise<boolean> {
  try {
    const form = page.locator(formSelector)
    if (!(await form.isVisible())) return false

    for (const [name, value] of Object.entries(fieldValues)) {
      const field = form.locator(`[name="${name}"], #${name}`).first()
      if (await field.isVisible()) {
        const tagName = await field.evaluate((el: Element) => el.tagName.toLowerCase())
        if (tagName === 'select') {
          await field.selectOption(value)
        } else {
          await field.fill(value)
        }
      }
    }

    const submitBtn = form.locator('button[type="submit"], input[type="submit"], button:has-text("Submit")').first()
    if (await submitBtn.isVisible()) {
      await submitBtn.click()
      return true
    }

    await page.keyboard.press('Enter')
    return true
  } catch {
    return false
  }
}

export async function attemptAuthFlow(page: Page, credentials: { username: string; password: string }): Promise<boolean> {
  try {
    const passwordField = page.locator('input[type="password"]').first()
    if (!(await passwordField.isVisible())) return false

    const usernameSelectors = [
      'input[type="email"]',
      'input[type="text"][name*="user"]',
      'input[type="text"][name*="login"]',
      'input[type="text"][name*="email"]',
      'input[type="text"][autocomplete="username"]',
      'input:not([type])[name*="user"]',
      'input:not([type])[name*="login"]',
      'input:not([type])[name*="email"]',
    ]

    let usernameField = page.locator(usernameSelectors[0]).first()
    for (const sel of usernameSelectors) {
      const candidate = page.locator(sel).first()
      if (await candidate.isVisible()) {
        usernameField = candidate
        break
      }
    }

    if (!(await usernameField.isVisible())) return false

    await usernameField.fill(credentials.username)
    await passwordField.fill(credentials.password)

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'button:has-text("Submit")',
    ]

    for (const sel of submitSelectors) {
      const submitBtn = page.locator(sel).first()
      if (await submitBtn.isVisible()) {
        await submitBtn.click()
        return true
      }
    }

    await page.keyboard.press('Enter')
    return true
  } catch {
    return false
  }
}
