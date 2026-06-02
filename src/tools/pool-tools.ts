/**
 * src/tools/pool-tools.ts
 *
 * LangChain tools that wrap SessionPool operations. These are exposed to
 * the LLM agent so it can switch sessions, log in new ones, take
 * screenshots, and diff two sessions' views of the same URL.
 *
 * Why these are separate from `httpRequest`: the existing httpRequest
 * tool uses the worker's single apiContext. To test cross-user behavior
 * the agent needs to control which session is making the request.
 *
 * Each tool returns a structured JSON string so the LLM can parse it.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { SessionPool } from '../core/session-pool';
import type { Page } from 'playwright';

export interface SessionToolContext {
  pool: SessionPool;
  getActiveSessionId(): string | null;
  setActiveSessionId(id: string | null): void;
  getPage(id: string): Promise<Page>;
}

export function buildSessionTools(ctx: SessionToolContext) {
  const listSessions = tool(
    async () => {
      const sessions = ctx.pool.list();
      return JSON.stringify({ sessions }, null, 2);
    },
    {
      name: 'list_sessions',
      description: 'List all sessions in the pool with id, label, role, and authenticated status. Use this before any other session tool to know what is available.',
      schema: z.object({}),
    },
  );

  const switchSession = tool(
    async (input) => {
      const { sessionId } = input;
      if (!ctx.pool.has(sessionId)) return JSON.stringify({ error: `Session "${sessionId}" not found` });
      const meta = ctx.pool.switchTo(sessionId);
      ctx.setActiveSessionId(sessionId);
      return JSON.stringify({ switchedTo: meta }, null, 2);
    },
    {
      name: 'switch_session',
      description: 'Make a named session the active one. All subsequent httpRequest / observeResponse / screenshot calls will use this session until you switch again.',
      schema: z.object({ sessionId: z.string().describe('The id returned by list_sessions') }),
    },
  );

  const loginSession = tool(
    async (input) => {
      const { sessionId, loginEndpoint, fields, method, contentType } = input;
      if (!ctx.pool.has(sessionId)) return JSON.stringify({ error: `Session "${sessionId}" not found` });
      const result = await ctx.pool.login(sessionId, {
        loginEndpoint,
        method: method ?? 'POST',
        contentType: contentType ?? 'json',
        fields,
      });
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'login_session',
      description: 'Authenticate a session by POSTing/GETting credentials to a login endpoint. Use this after switching to an anon session to make it authenticated.',
      schema: z.object({
        sessionId: z.string().describe('The id of the session to log in'),
        loginEndpoint: z.string().url().describe('Absolute URL of the login endpoint'),
        fields: z.record(z.string()).describe('Credential fields, e.g. {"email":"...","password":"..."}'),
        method: z.enum(['GET', 'POST']).optional().describe('HTTP method; default POST'),
        contentType: z.enum(['json', 'form']).optional().describe('Body format; default json'),
      }),
    },
  );

  const diffSessions = tool(
    async (input) => {
      const { sessionA, sessionB, url, method, headers, body } = input;
      if (!ctx.pool.has(sessionA)) return JSON.stringify({ error: `Session "${sessionA}" not found` });
      if (!ctx.pool.has(sessionB)) return JSON.stringify({ error: `Session "${sessionB}" not found` });
      const result = await ctx.pool.diff(sessionA, sessionB, {
        url,
        method: method ?? 'GET',
        headers: headers ?? undefined,
        body: body ?? undefined,
      });
      return JSON.stringify(result, null, 2);
    },
    {
      name: 'diff_sessions',
      description: 'Send the same request as two different sessions and compare responses. Returns a leakDetected boolean and a notes array explaining what was found. Use this for IDOR and broken function-level auth tests.',
      schema: z.object({
        sessionA: z.string().describe('Id of the first session (e.g. user-a)'),
        sessionB: z.string().describe('Id of the second session (e.g. user-b or admin)'),
        url: z.string().url().describe('Absolute URL to fetch'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional().describe('Request body as a string'),
      }),
    },
  );

  const screenshotSession = tool(
    async (input) => {
      const { sessionId, fullPage } = input;
      if (!ctx.pool.has(sessionId)) return JSON.stringify({ error: `Session "${sessionId}" not found` });
      const path = await ctx.pool.screenshot(sessionId, { fullPage: fullPage ?? true });
      return JSON.stringify({ screenshot: path }, null, 2);
    },
    {
      name: 'screenshot_session',
      description: 'Capture a screenshot of the current page in the named session. Use this to record rendered DOM when payload reflection is not visible in raw response bodies.',
      schema: z.object({
        sessionId: z.string().describe('The id of the session to capture'),
        fullPage: z.boolean().optional().describe('Capture the full scrollable page; default true'),
      }),
    },
  );

  const getPageText = tool(
    async (input) => {
      const { sessionId, selector } = input;
      if (!ctx.pool.has(sessionId)) return JSON.stringify({ error: `Session "${sessionId}" not found` });
      const page = await ctx.getPage(sessionId);
      const text = selector
        ? await page.locator(selector).first().innerText().catch(() => '')
        : await page.evaluate(() => (globalThis as any).document?.body?.innerText || '');
      return JSON.stringify({ text: text.slice(0, 4000) }, null, 2);
    },
    {
      name: 'get_page_text',
      description: 'Read the visible text of the current page (or a specific selector). Use this to read on-screen hints, error messages, and any text not visible in raw HTTP responses.',
      schema: z.object({
        sessionId: z.string().describe('The id of the session to read from'),
        selector: z.string().optional().describe('CSS selector; if omitted reads body innerText'),
      }),
    },
  );

  return {
    listSessions,
    switchSession,
    loginSession,
    diffSessions,
    screenshotSession,
    getPageText,
  };
}

export type SessionTools = ReturnType<typeof buildSessionTools>;
