/**
 * Camoufox browser tools (Phase A, spec 02 A5).
 *
 * The same 7 tool ids as the stagehand surface, implemented over plain
 * Playwright page/context primitives. v1 is crawl-grade: navigation,
 * screenshots, tabs, and extraction are first-class; `act` executes an LLM-
 * supplied selector/plan via locator semantics; `observe` returns the
 * accessibility snapshot. Stagehand's self-healing AI actions are out of
 * scope for v1 (documented decision — the root cause being fixed is
 * fingerprinting, not interaction quality).
 *
 * Tool results mirror the stagehand shapes ({ success, url, ... }) so
 * wrapStagehandTools, graph-bridge, and spider consumers work unchanged.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { Page, BrowserContext } from 'playwright'

export interface CamoufoxToolContext {
  page: Page
  context: BrowserContext
  /** Excluded tool ids (mirrors manager's stagehand_close exclusion). */
  exclude?: string[]
}

function buildNavigate(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_navigate',
    description: 'Navigate the authorized browser session to a URL.',
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      try {
        const response = await ctx.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        return {
          success: true,
          url: ctx.page.url(),
          status: typeof response?.status === 'function' ? response.status() : response?.status() ?? 0,
          title: await ctx.page.title().catch(() => ''),
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

function buildAct(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_act',
    description:
      'Perform one described action in the authorized browser session. Supply a CSS selector (or text= locator expression) and an action; crawl-grade execution over Playwright locators.',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector or text=/role= locator expression'),
      action: z.enum(['click', 'fill', 'check', 'uncheck', 'press', 'scroll']).default('click'),
      value: z.string().optional().describe('Value for fill / key for press'),
      timeoutMs: z.number().int().positive().default(8000),
    }),
    execute: async ({ selector, action, value, timeoutMs }) => {
      try {
        const locator = selector.startsWith('text=') || selector.startsWith('role=')
          ? ctx.page.locator(selector)
          : ctx.page.locator(selector).first()
        await locator.waitFor({ state: 'visible', timeout: timeoutMs })
        switch (action) {
          case 'click': await locator.click({ timeout: timeoutMs }); break
          case 'fill': await locator.fill(value ?? '', { timeout: timeoutMs }); break
          case 'check': await locator.check({ timeout: timeoutMs }); break
          case 'uncheck': await locator.uncheck({ timeout: timeoutMs }); break
          case 'press': await locator.press(value ?? 'Enter', { timeout: timeoutMs }); break
          case 'scroll':
            await locator.evaluate((el) => el.scrollIntoView({ block: 'center' }))
            break
        }
        return { success: true, action, selector, url: ctx.page.url() }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err), action, selector }
      }
    },
  })
}

function buildExtract(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_extract',
    description: 'Extract structured information from the current browser page.',
    inputSchema: z.object({
      selector: z.string().optional().describe('Limit extraction to elements matching this selector'),
      maxLength: z.number().int().positive().max(200_000).default(20_000),
    }),
    execute: async ({ selector, maxLength }) => {
      try {
        const text = selector
          ? await ctx.page.locator(selector).first().innerText({ timeout: 8000 })
          : await ctx.page.evaluate(() => document.body?.innerText ?? '')
        const links = await ctx.page.$$eval('a[href]', (els) =>
          els.slice(0, 100).map((el) => (el as HTMLAnchorElement).href),
        ).catch(() => [])
        return {
          success: true,
          url: ctx.page.url(),
          title: await ctx.page.title().catch(() => ''),
          text: String(text).slice(0, maxLength),
          links,
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

function buildObserve(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_observe',
    description: 'Observe actionable elements on the current browser page (accessibility snapshot + interactive controls).',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const aria = await ctx.page.locator('body').ariaSnapshot().catch(() => '')
        const controls = await ctx.page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll('a[href], button, input, select, textarea'))
          return nodes.slice(0, 80).map((el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || '').trim().slice(0, 80),
            href: el instanceof HTMLAnchorElement ? el.href : undefined,
            type: el instanceof HTMLInputElement ? el.type : undefined,
          }))
        }).catch(() => [])
        return { success: true, url: ctx.page.url(), ariaSnapshot: String(aria).slice(0, 30_000), controls }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

function buildScreenshot(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_screenshot',
    description: 'Capture a screenshot of the current browser page.',
    inputSchema: z.object({ fullPage: z.boolean().default(false) }),
    execute: async ({ fullPage }) => {
      try {
        const buffer = await ctx.page.screenshot({ fullPage })
        return { success: true, base64: buffer.toString('base64'), url: ctx.page.url() }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

function buildTabs(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_tabs',
    description: 'Inspect or change tabs in the current browser session.',
    inputSchema: z.object({
      action: z.enum(['list', 'select', 'new', 'close']).default('list'),
      index: z.number().int().min(0).optional(),
    }),
    execute: async ({ action, index }) => {
      try {
        const pages = ctx.context.pages()
        if (action === 'list') {
          return {
            success: true,
            tabs: pages.map((p, i) => ({ index: i, url: p.url() })),
            activeIndex: pages.indexOf(ctx.page),
          }
        }
        if (action === 'select') {
          if (index === undefined || index < 0 || index >= pages.length) {
            return { success: false, error: `tab index out of range (${pages.length} open)` }
          }
          const target = pages[index]
          await target.bringToFront()
          // Rebind the active page so subsequent tools act on the selected tab.
          ;(ctx as { page: Page }).page = target
          return { success: true, activeIndex: index, url: target.url() }
        }
        if (action === 'new') {
          const page = await ctx.context.newPage()
          ;(ctx as { page: Page }).page = page
          return { success: true, url: page.url(), tabIndex: ctx.context.pages().length - 1 }
        }
        // close
        if (pages.length <= 1) return { success: false, error: 'refusing to close the last tab' }
        const idx = index ?? pages.indexOf(ctx.page)
        await pages[idx]?.close()
        return { success: true, remainingTabs: ctx.context.pages().length }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

function buildClose(ctx: CamoufoxToolContext) {
  return createTool({
    id: 'stagehand_close',
    description: 'Close the current browser page.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await ctx.page.close()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })
}

/** Build the provider tool surface. Same ids/shapes as the stagehand surface. */
export function createCamoufoxTools(ctx: CamoufoxToolContext): Record<string, any> {
  const tools: Record<string, any> = {
    stagehand_navigate: buildNavigate(ctx),
    stagehand_act: buildAct(ctx),
    stagehand_extract: buildExtract(ctx),
    stagehand_observe: buildObserve(ctx),
    stagehand_screenshot: buildScreenshot(ctx),
    stagehand_tabs: buildTabs(ctx),
    stagehand_close: buildClose(ctx),
  }
  for (const name of ctx.exclude ?? []) delete tools[name]
  return tools
}
