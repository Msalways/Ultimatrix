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

  it('LLM spawnAgent → sub-agent httpRequest → real response → sub-agent writeFinding → finding emitted', async () => {
    // The meta-orchestrator has only MANAGER tools. It must spawnAgent to
    // delegate HTTP work. The sub-agent gets the execution primitives.
    const llm = new ScriptedLLM([
      // Meta turn 1: spawn a sub-agent to probe /level1 for reflected XSS
      {
        text: JSON.stringify({
          thought: 'I need to probe /level1 for reflected XSS. I\'ll spawn a sub-agent with httpRequest, evaluateRendered, and writeFinding.',
          tool: 'spawnAgent',
          args: {
            task: 'Probe /level1?query with an XSS payload and report findings.',
            tools: ['httpRequest', 'evaluateRendered', 'writeFinding', 'recordEvidence'],
            maxAttempts: 5,
            strategy: 'Send <script>alert(1)</script> in query param, check if unescaped in response.',
          },
        }),
      },
      // Sub-agent turn 1: send the HTTP request (real server hit)
      {
        text: JSON.stringify({
          thought: 'Sending XSS payload in query param.',
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
      // Sub-agent turn 2: finding emitted based on the response
      {
        text: JSON.stringify({
          thought: 'Response contains <script>alert(1)</script> unescaped — confirmed XSS.',
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
      // Sub-agent triage (called by emitFinding)
      {
        text: JSON.stringify({ real: true, reasoning: 'Payload appears unescaped in response body.' }),
      },
      // Meta turn 2: sub-agent found it, done
      {
        text: JSON.stringify({
          thought: 'Sub-agent confirmed reflected XSS on /level1. Finding already recorded. Done.',
          tool: 'giveUp',
          args: {},
        }),
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
      initialPhase: 'attack',
    });

    // 1) The HTTP request actually reached the target server
    expect(target.hits.length).toBe(1);
    expect(target.hits[0].url).toContain('/level1');
    expect(target.hits[0].url).toContain('script');

    // 2) The meta-orchestrator spawned a sub-agent, then gave up
    expect(trace.metaTurns.length).toBeGreaterThanOrEqual(2);
    expect(trace.metaTurns[0].tool).toBe('spawnAgent');
    expect(trace.metaTurns[0].result?.ok).toBe(true);

    // 3) The sub-agent made the HTTP request internally
    expect(trace.subAgents.length).toBe(1);
    expect(trace.subAgents[0].turns.length).toBeGreaterThanOrEqual(2);
    expect(trace.subAgents[0].turns[0].tool).toBe('httpRequest');
    expect(trace.subAgents[0].turns[0].result?.ok).toBe(true);
    const subWriteIdx = trace.subAgents[0].turns.findIndex((t) => t.tool === 'writeFinding');
    expect(subWriteIdx).toBeGreaterThanOrEqual(1);
    expect(trace.subAgents[0].turns[subWriteIdx]).toBeDefined();
    expect(trace.subAgents[0].outcome).toBe('vulnerable');

    // 4) A finding was emitted with the right shape (propagated from sub-agent)
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('reflected-xss');
    expect(findings[0].endpoint).toContain('/level1');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('LLM spawnAgent → sub-agent httpRequest + parseResponse + writeFinding → finding emitted', async () => {
    target.hits.length = 0;
    // Meta spawns a sub-agent to handle the full chain; sub-agent does
    // httpRequest → parseResponse → writeFinding internally.
    const llm = new ScriptedLLM([
      // Meta turn 1: delegate to sub-agent
      {
        text: JSON.stringify({
          thought: 'Delegating request + parse + finding to a sub-agent.',
          tool: 'spawnAgent',
          args: {
            task: 'Send GET to /level1?query=hi, parse response, and emit a finding if reflected.',
            tools: ['httpRequest', 'parseResponse', 'writeFinding', 'recordEvidence'],
            maxAttempts: 5,
          },
        }),
      },
      // Sub-agent turn 1: httpRequest
      {
        text: JSON.stringify({
          thought: 'Sending request with query=hi.',
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
      // Sub-agent turn 2: parseResponse
      {
        text: JSON.stringify({
          thought: 'Parse the response to extract body.',
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
      // Sub-agent turn 3: writeFinding
      {
        text: JSON.stringify({
          thought: 'Response reflected "hi" — confirmed XSS surface.',
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
      // Sub-agent triage
      {
        text: JSON.stringify({ real: true, reasoning: 'Reflected user input.' }),
      },
      // Meta turn 2: done
      {
        text: JSON.stringify({
          thought: 'Sub-agent found reflected XSS. Done.',
          tool: 'giveUp',
          args: {},
        }),
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
      initialPhase: 'attack',
    });

    // Meta spawned a sub-agent
    expect(trace.metaTurns[0].tool).toBe('spawnAgent');
    expect(trace.metaTurns[0].result?.ok).toBe(true);

    // Sub-agent executed httpRequest → parseResponse → writeFinding
    expect(trace.subAgents.length).toBe(1);
    expect(trace.subAgents[0].turns.length).toBeGreaterThanOrEqual(3);
    expect(trace.subAgents[0].turns[0].tool).toBe('httpRequest');
    expect(trace.subAgents[0].turns[0].result?.ok).toBe(true);
    const spParseIdx = trace.subAgents[0].turns.findIndex((t) => t.tool === 'parseResponse');
    expect(spParseIdx).toBeGreaterThanOrEqual(1);
    expect(trace.subAgents[0].turns[spParseIdx].result?.ok).toBe(true);
    const spWriteIdx = trace.subAgents[0].turns.findIndex((t) => t.tool === 'writeFinding');
    expect(spWriteIdx).toBeGreaterThan(spParseIdx);

    // Finding propagated upward
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
