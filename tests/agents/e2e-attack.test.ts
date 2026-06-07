/**
 * tests/agents/e2e-attack.test.ts
 *
 * Block 19: end-to-end test that proves the agent loop ACTUALLY performs
 * attacks — i.e. that the LLM tool calls result in real HTTP requests
 * that return real responses, and that the agent can reason over the
 * results to call writeFinding.
 *
 * We use a real local HTTP server as the target. We use a fake LLM that
 * returns canned tool calls (following the schema's wrap pattern) so we
 * can drive the loop deterministically.
 *
 * If this test fails, the agent is broken end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import { runAgentLoop } from '../../src/agents/agent-loop';
import type { LLMClient, LLMCall, LLMCallResult } from '../../src/llm/client';
import type { PrimitiveContext } from '../../src/primitives/types';

interface CannedResponse {
  text: string;
  delayMs?: number;
}

class ScriptedLLM implements LLMClient {
  private queue: CannedResponse[];
  private calls: LLMCall[] = [];

  constructor(responses: CannedResponse[]) {
    this.queue = [...responses];
  }

  getCalls(): LLMCall[] { return this.calls; }

  async call(c: LLMCall): Promise<LLMCallResult> {
    this.calls.push(c);
    const r = this.queue.shift();
    if (!r) throw new Error('ScriptedLLM ran out of canned responses');
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    // Best-effort: parse the JSON for callers that read res.json (e.g. triage).
    let json: any = null;
    try { json = JSON.parse(r.text); } catch { /* keep null */ }
    return { text: r.text, json, provider: 'mock', model: 'scripted', durationMs: 0 };
  }
  isReal(): boolean { return false; }
  async *stream(): AsyncGenerator<string> { throw new Error('not supported'); }
  getProviderName(): string { return 'mock'; }
  getModelName(): string { return 'scripted'; }
  async ensureModel(): Promise<boolean> { return true; }
}

function startTargetServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  hits: { method?: string; url?: string; body?: string }[];
}> {
  return new Promise((resolve) => {
    const hits: { method?: string; url?: string; body?: string }[] = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c.toString()));
      req.on('end', () => {
        const hit = { method: req.method, url: req.url, body };
        hits.push(hit);
        // Reflect the query param back, unescaped. The classic XSS
        // playground: GET /level1?query=<script>... → body contains the script tag literally.
        if (req.url?.startsWith('/level1')) {
          const u = new URL(req.url, `http://127.0.0.1`);
          const q = u.searchParams.get('query') || '';
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(`<html><body>You searched: ${q}</body></html>`);
        } else {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end('ok');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        hits,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('e2e attack (Block 19): agent loop actually performs attacks', () => {
  let target: Awaited<ReturnType<typeof startTargetServer>>;
  let ctx: PrimitiveContext;

  beforeAll(async () => {
    target = await startTargetServer();
    ctx = {
      baseUrl: `http://127.0.0.1:${target.port}`,
      cookies: {},
      evidenceLog: [],
      depth: 0,
      budget: { startedAt: Date.now(), maxMs: 30_000 },
    };
  });

  afterAll(async () => {
    await target.close();
  });

  it('LLM httpRequest → real HTTP request → real response → LLM writeFinding → finding emitted', async () => {
    // The LLM is scripted to:
    //   1) Send a wrapped httpRequest to /level1?query=<script>alert(1)</script>
    //   2) Read the response body, see the script tag reflected, and call writeFinding
    //   3) Triage confirms the finding is real
    const llm = new ScriptedLLM([
      {
        // Turn 1: probe with XSS payload (WRAPPED form per the schema)
        text: JSON.stringify({
          thought: 'Reflected XSS — let\'s probe /level1 with a script tag in query.',
          tool: 'httpRequest',
          args: {
            request: {
              method: 'GET',
              url: `http://127.0.0.1:${target.port}/level1?query=%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
              headers: {},
              timeoutMs: 5000,
            },
          },
        }),
      },
      {
        // Turn 2: confirm the payload appears unescaped, then writeFinding
        text: JSON.stringify({
          thought: 'Response contains <script>alert(1)</script> unescaped. Confirmed reflected XSS.',
          tool: 'writeFinding',
          args: {
            type: 'reflected-xss',
            endpoint: `http://127.0.0.1:${target.port}/level1`,
            param: 'query',
            method: 'GET',
            payload: '<script>alert(1)</script>',
            description: 'The query parameter is reflected in the response body without HTML encoding.',
            severity: 'high',
            confidence: 0.95,
          },
        }),
      },
      {
        // Triage (extra LLM call from emitFinding) — confirms real
        text: JSON.stringify({ real: true, reasoning: 'Payload appears unescaped in response body.' }),
      },
    ]);

    const { trace, findings } = await runAgentLoop({
      target: {
        url: `http://127.0.0.1:${target.port}/level1`,
        method: 'GET',
        params: [{ name: 'query', type: 'string', required: false }],
        bodyPreview: '<html>You searched: {query}</html>',
      },
      ctx,
      llm,
      maxMetaTurns: 5,
    });

    // 1) The HTTP request actually reached the target server
    expect(target.hits.length).toBe(1);
    expect(target.hits[0].url).toContain('/level1');
    expect(target.hits[0].url).toContain('script');

    // 2) The agent ran 2 turns: httpRequest + writeFinding
    expect(trace.metaTurns.length).toBeGreaterThanOrEqual(2);
    expect(trace.metaTurns[0].tool).toBe('httpRequest');
    expect(trace.metaTurns[0].result?.ok).toBe(true);
    const writeIdx = trace.metaTurns.findIndex((t) => t.tool === 'writeFinding');
    expect(writeIdx).toBeGreaterThanOrEqual(1);
    expect(trace.metaTurns[writeIdx]).toBeDefined();

    // 3) A finding was emitted with the right shape
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('reflected-xss');
    expect(findings[0].endpoint).toContain('/level1');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('LLM chained: httpRequest → parseResponse → writeFinding', async () => {
    target.hits.length = 0;
    const llm = new ScriptedLLM([
      // Turn 1: send the request
      {
        text: JSON.stringify({
          thought: 'GET /level1?query=hi',
          tool: 'httpRequest',
          args: {
            request: {
              method: 'GET',
              url: `http://127.0.0.1:${target.port}/level1?query=hi`,
              headers: {},
              timeoutMs: 5000,
            },
          },
        }),
      },
      // Turn 2: parse the response (WRAPPED form per the schema)
      {
        text: JSON.stringify({
          thought: 'Parse the response to look for the reflected value.',
          tool: 'parseResponse',
          args: {
            response: {
              status: 200,
              url: 'http://x.com',
              finalUrl: 'http://x.com',
              headers: {},
              body: '<html>You searched: hi</html>',
              durationMs: 1,
              redirects: [],
              timing: { dns: 0, connect: 0, tls: 0, ttfb: 0, download: 0 },
            },
          },
        }),
      },
      // Turn 3: writeFinding based on the parse
      {
        text: JSON.stringify({
          thought: 'The response reflected "hi" — confirmed reflected XSS surface.',
          tool: 'writeFinding',
          args: {
            type: 'reflected-xss',
            endpoint: `http://127.0.0.1:${target.port}/level1`,
            param: 'query',
            method: 'GET',
            payload: 'hi',
            description: 'User input reflected in response body.',
            severity: 'medium',
            confidence: 0.6,
          },
        }),
      },
      {
        // Triage confirms real
        text: JSON.stringify({ real: true, reasoning: 'Reflected user input.' }),
      },
    ]);

    const { trace, findings } = await runAgentLoop({
      target: {
        url: `http://127.0.0.1:${target.port}/level1`,
        method: 'GET',
        params: [{ name: 'query', type: 'string', required: false }],
      },
      ctx,
      llm,
      maxMetaTurns: 5,
    });

    expect(trace.metaTurns.length).toBeGreaterThanOrEqual(3);
    expect(trace.metaTurns[0].tool).toBe('httpRequest');
    expect(trace.metaTurns[0].result?.ok).toBe(true);
    const parseIdx = trace.metaTurns.findIndex((t) => t.tool === 'parseResponse');
    expect(parseIdx).toBe(1);
    expect(trace.metaTurns[parseIdx].result?.ok).toBe(true);
    const writeIdx = trace.metaTurns.findIndex((t) => t.tool === 'writeFinding');
    expect(writeIdx).toBe(2);
    expect(trace.metaTurns[writeIdx]).toBeDefined();
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('reflected-xss');
  });

  it('LLM giveUp → clean trace, 0 findings', async () => {
    target.hits.length = 0;
    const llm = new ScriptedLLM([
      {
        text: JSON.stringify({
          thought: 'No clear attack surface here, giving up.',
          tool: 'giveUp',
          args: {},
        }),
      },
    ]);
    const { trace, findings } = await runAgentLoop({
      target: { url: `http://127.0.0.1:${target.port}/`, method: 'GET' },
      ctx,
      llm,
      maxMetaTurns: 5,
    });
    expect(trace.metaTurns).toHaveLength(1);
    expect(trace.metaTurns[0].tool).toBe('giveUp');
    expect(findings).toHaveLength(0);
    expect(trace.outcome).toBe('clean');
    // No HTTP traffic was generated
    expect(target.hits.length).toBe(0);
  });

  it('LLM garbled JSON → parse fails → agent bails with error', async () => {
    target.hits.length = 0;
    const llm = new ScriptedLLM([
      { text: 'this is not JSON at all' },
    ]);
    const { trace, findings } = await runAgentLoop({
      target: { url: `http://127.0.0.1:${target.port}/`, method: 'GET' },
      ctx,
      llm,
      maxMetaTurns: 3,
    });
    expect(findings).toHaveLength(0);
    expect(trace.outcome).toBe('invalid');
    expect(target.hits.length).toBe(0);
  });
});
