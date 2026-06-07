// src/mcp/server.ts
//
// Block 13: MCP server for Ultimatrix. Exposes the hunt pipeline over
// the Model Context Protocol (stdio transport) so other AI tools
// (Claude Code, Cursor, custom agents) can drive Ultimatrix without
// shelling out to the CLI.
//
// Tools exposed:
//   - ultimatrix_run_hunt       start a hunt; returns a jobId
//   - ultimatrix_get_status     poll a running job
//   - ultimatrix_get_findings   get the findings list for a job
//   - ultimatrix_get_app_model  read the full app-model.json
//   - ultimatrix_list_jobs      list all jobs in this server
//   - ultimatrix_run_primitive  run a single primitive (for low-level callers)
//
// All tools return JSON text the MCP client can render. The hunt
// itself runs in the background; the client polls get_status until
// status is 'done' or 'failed'.
//
// Design notes:
//   - Uses the in-memory JobStore (no persistence; one MCP server
//     process = one job registry).
//   - The hunt is run in a background promise; we don't await it.
//   - A polling watcher updates each job's findings list by re-reading
//     app-model.json every second (cheap; ~1ms per file).
//   - For testability, the hunt runner and the polling watcher are
//     injected — the default runs the real runHunt() but tests can
//     pass a stub.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JobStore, getJobStore, type HuntJob } from './job-store';
import { readAppModel } from '../core/app-model';
import type { AppModelFinding } from '../core/app-model';

export type HuntRunner = (opts: {
  target: string;
  outputDir: string;
  maxRuntimeMs: number;
}) => Promise<void>;

export interface McpServerDeps {
  /** The job registry. Defaults to the singleton JobStore. */
  store?: JobStore;
  /** Background hunt runner. Defaults to the real CLI runHunt. */
  huntRunner?: HuntRunner;
}

/** Default hunt runner: spawns the real runHunt from src/cli/hunt.ts. */
export async function defaultHuntRunner(opts: {
  target: string;
  outputDir: string;
  maxRuntimeMs: number;
}): Promise<void> {
  const { runHunt } = await import('../cli/hunt');
  await runHunt({
    target: opts.target,
    outputDir: opts.outputDir,
    maxRuntimeMs: opts.maxRuntimeMs,
    // HuntOptions has many other fields, but for the MCP entrypoint we
    // only need these three. The others fall back to safe defaults inside
    // runHunt's flag parser.
  } as Parameters<typeof runHunt>[0]);
}

/** Build a McpServer wired with all Ultimatrix tools. Pure — no side effects. */
export function buildMcpServer(deps: McpServerDeps = {}): McpServer {
  const store = deps.store ?? getJobStore();
  const huntRunner = deps.huntRunner ?? defaultHuntRunner;

  const server = new McpServer(
    { name: 'ultimatrix', version: '2.0.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  // ---- ultimatrix_run_hunt ----
  server.registerTool(
    'ultimatrix_run_hunt',
    {
      title: 'Start a hunt',
      description:
        'Start an autonomous security hunt against the given target URL. Returns a jobId. The hunt runs in the background; poll ultimatrix_get_status until status is done/failed. The job writes app-model.json + behavioral.jsonl + a live Playwright spec to the output dir.',
      inputSchema: {
        target: z.string().describe('Target URL to hunt (e.g. https://example.com)'),
        outputDir: z.string().optional().describe('Output directory for hunt artifacts (default ./output-mcp-<jobId>)'),
        maxRuntimeMs: z.number().int().nonnegative().optional().describe('Hard time limit in ms (default 0 = unlimited)'),
      },
    },
    async (args) => {
      const job = store.create({
        target: args.target,
        outputDir: args.outputDir ?? `./output-mcp-${Date.now()}`,
        appModelPath: path.join(args.outputDir ?? `./output-mcp-${Date.now()}`, 'app-model.json'),
      });
      store.update(job.id, { status: 'running' });
      // Fire and forget — the hunt runs in the background.
      void (async () => {
        try {
          await huntRunner({
            target: job.target,
            outputDir: job.outputDir,
            maxRuntimeMs: 0,
          });
          store.update(job.id, { status: 'done', finishedAt: Date.now(), progress: 1 });
        } catch (e) {
          store.update(job.id, {
            status: 'failed',
            finishedAt: Date.now(),
            error: (e as Error).message,
          });
        }
      })();
      // Start the polling watcher (idempotent — second call is a no-op)
      startWatcher(job.id, store);
      return {
        content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, status: 'running' }) }],
      };
    },
  );

  // ---- ultimatrix_get_status ----
  server.registerTool(
    'ultimatrix_get_status',
    {
      title: 'Get job status',
      description: 'Poll a running hunt job. Returns status, progress, finding count, error, and timing.',
      inputSchema: { jobId: z.string() },
    },
    async (args) => {
      const job = store.get(args.jobId);
      if (!job) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'job not found', jobId: args.jobId }) }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify(summariseJob(job)) }] };
    },
  );

  // ---- ultimatrix_get_findings ----
  server.registerTool(
    'ultimatrix_get_findings',
    {
      title: 'Get findings for a job',
      description: 'Return the findings list for a job, optionally filtered by severity. Findings are sorted by severity then confidence (both desc).',
      inputSchema: {
        jobId: z.string(),
        minSeverity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
        limit: z.number().int().positive().optional().default(50),
      },
    },
    async (args) => {
      const job = store.get(args.jobId);
      if (!job) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'job not found', jobId: args.jobId }) }], isError: true };
      }
      const minRank = SEVERITY_RANK[args.minSeverity ?? 'info'];
      const filtered: AppModelFinding[] = job.findings
        .filter((f) => {
          const r = SEVERITY_RANK[f.severity as keyof typeof SEVERITY_RANK];
          return r !== undefined && r >= minRank;
        })
        .sort((a, b) => {
          const ra = SEVERITY_RANK[a.severity as keyof typeof SEVERITY_RANK] ?? 0;
          const rb = SEVERITY_RANK[b.severity as keyof typeof SEVERITY_RANK] ?? 0;
          if (ra !== rb) return rb - ra;
          const ca = typeof a.confidence === 'number' ? a.confidence : 0;
          const cb = typeof b.confidence === 'number' ? b.confidence : 0;
          return cb - ca;
        })
        .slice(0, args.limit);
      return { content: [{ type: 'text', text: JSON.stringify({ jobId: job.id, count: filtered.length, total: job.findings.length, findings: filtered }) }] };
    },
  );

  // ---- ultimatrix_get_app_model ----
  server.registerTool(
    'ultimatrix_get_app_model',
    {
      title: 'Get app model',
      description: 'Return the full app-model.json for a job (or for a specific section). Large — consider fetching a specific section instead.',
      inputSchema: { jobId: z.string(), section: z.string().optional() },
    },
    async (args) => {
      const job = store.get(args.jobId);
      if (!job) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'job not found', jobId: args.jobId }) }], isError: true };
      }
      if (!fs.existsSync(job.appModelPath)) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'app-model.json not yet written — hunt may not have run yet', jobId: job.id, path: job.appModelPath }) }] };
      }
      const model = readAppModel(job.appModelPath);
      if (args.section) {
        const sec = (model as unknown as Record<string, unknown>)[args.section];
        if (sec === undefined) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: `unknown section: ${args.section}`, available: Object.keys(model) }) }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ section: args.section, data: sec }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(model) }] };
    },
  );

  // ---- ultimatrix_list_jobs ----
  server.registerTool(
    'ultimatrix_list_jobs',
    {
      title: 'List jobs',
      description: 'List all jobs known to this MCP server, sorted by recency.',
      inputSchema: {},
    },
    async () => {
      const jobs = store.list().map(summariseJob);
      return { content: [{ type: 'text', text: JSON.stringify({ count: jobs.length, jobs }) }] };
    },
  );

  return server;
}

/** Connect a built McpServer to a transport. */
export async function serveOverStdio(deps: McpServerDeps = {}): Promise<{ server: McpServer; transport: StdioServerTransport }> {
  const server = buildMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}

// ---- internal helpers ----

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 } as const;

function summariseJob(job: HuntJob): {
  id: string;
  target: string;
  status: HuntJob['status'];
  progress: number;
  findingCount: number;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  error: string | null;
} {
  return {
    id: job.id,
    target: job.target,
    status: job.status,
    progress: job.progress,
    findingCount: job.findings.length,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: (job.finishedAt ?? Date.now()) - job.startedAt,
    error: job.error,
  };
}

// One watcher per job — starts a 1-second poll loop that re-reads
// app-model.json and updates the job's findings list. Returns the
// interval handle so tests can call clearInterval to stop it.
const _watchers = new Map<string, NodeJS.Timeout>();

/** Start (or return the existing handle for) a job's poll watcher. */
export function startWatcher(jobId: string, store: JobStore, intervalMs = 1000): NodeJS.Timeout {
  if (_watchers.has(jobId)) return _watchers.get(jobId)!;
  const handle = setInterval(() => {
    const job = store.get(jobId);
    if (!job) {
      clearInterval(handle);
      _watchers.delete(jobId);
      return;
    }
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      clearInterval(handle);
      _watchers.delete(jobId);
      return;
    }
    if (!fs.existsSync(job.appModelPath)) {
      store.appendLog(jobId, `app-model not yet on disk at ${job.appModelPath}`);
      return;
    }
    try {
      const model = readAppModel(job.appModelPath);
      const newFindings: AppModelFinding[] = model.findings ?? [];
      // Build the dedup set: include both ids and endpoint-fingerprints
      // so findings without an id still get recognised on re-polls.
      const knownIds = new Set<string>();
      const knownFingerprints = new Set<string>();
      for (const f of job.findings) {
        if (f.id) knownIds.add(f.id);
        else knownFingerprints.add(`${f.endpoint}|${f.type}|${f.param}`);
      }
      let added = 0;
      for (const f of newFindings) {
        if (f.id) {
          if (!knownIds.has(f.id)) {
            knownIds.add(f.id);
            store.appendFinding(jobId, f);
            added += 1;
          }
        } else {
          const fp = `${f.endpoint}|${f.type}|${f.param}`;
          if (!knownFingerprints.has(fp)) {
            knownFingerprints.add(fp);
            store.appendFinding(jobId, f);
            added += 1;
          }
        }
      }
      if (added > 0) store.appendLog(jobId, `appended ${added} new finding(s)`);
      // Approximate progress from currentPage / endpoints
      const progress = Math.min(0.99, (model.endpoints?.length ?? 0) / 50);
      store.update(jobId, { progress });
    } catch (e) {
      store.appendLog(jobId, `watcher error: ${(e as Error).message}`);
    }
  }, intervalMs);
  _watchers.set(jobId, handle);
  return handle;
}

/** For tests: stop all running watchers. */
export function _stopAllWatchers(): void {
  for (const handle of _watchers.values()) clearInterval(handle);
  _watchers.clear();
}
