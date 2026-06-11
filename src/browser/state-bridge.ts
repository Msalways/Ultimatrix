import type { Stagehand } from '@browserbasehq/stagehand'

export interface BrowserState {
  cookies: Array<{ name: string; value: string; domain: string; path: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; expires?: number }>
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
}

export async function importStateIntoStagehand(
  stagehand: Stagehand,
  state: BrowserState
): Promise<void> {
  // Stagehand V3 uses context property
  const ctx = (stagehand as any).context
  if (!ctx) throw new Error('Stagehand context not available')

  if (state.cookies?.length > 0) {
    await ctx.addCookies(state.cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      httpOnly: c.httpOnly || false,
      secure: c.secure || false,
      sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax',
      expires: c.expires || Math.floor(Date.now() / 1000) + 86400,
    })))
  }

  if (state.localStorage && Object.keys(state.localStorage).length > 0) {
    const page = (stagehand as any).page
    if (page) {
      for (const [key, value] of Object.entries(state.localStorage)) {
        await page.evaluate((k: string, v: string) => localStorage.setItem(k, v), key, value)
      }
    }
  }
}

export async function exportStateFromStagehand(
  stagehand: Stagehand
): Promise<BrowserState> {
  const ctx = (stagehand as any).context
  const page = (stagehand as any).page

  const cookies = ctx ? await ctx.cookies() : []

  let lsData: Record<string, string> = {}
  if (page) {
    try {
      const result = await page.evaluate(() => {
        const items: Record<string, string> = {}
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (k) items[k] = window.localStorage.getItem(k) || ''
        }
        return items
      })
      lsData = result as Record<string, string>
    } catch {
      // localStorage not available in all contexts
    }
  }

  return {
    cookies: Array.isArray(cookies) ? cookies.map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
      expires: c.expires,
    })) : [],
    localStorage: lsData,
    sessionStorage: {},
  }
}

export async function importStateFromPlaywright(
  stagehand: Stagehand,
  storageStatePath: string
): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(storageStatePath, 'utf-8')
  const state = JSON.parse(raw) as {
    cookies: BrowserState['cookies']
    origins?: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>
  }

  if (state.cookies) {
    const ctx = (stagehand as any).context
    if (ctx) {
      await ctx.addCookies(state.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax',
        expires: c.expires || Math.floor(Date.now() / 1000) + 86400,
      })))
    }
  }

  if (state.origins && state.origins.length > 0) {
    const page = (stagehand as any).page
    if (page) {
      for (const origin of state.origins) {
        if (origin.localStorage) {
          await page.goto(origin.origin).catch(() => {})
          for (const item of origin.localStorage) {
            await page.evaluate((k: string, v: string) => localStorage.setItem(k, v), item.name, item.value)
          }
        }
      }
    }
  }
}