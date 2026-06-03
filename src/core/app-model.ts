import fs from 'fs';
import path from 'path';
import type { MacroStep } from './browser-session';

// ── Workflow Graph ──

export interface WorkflowNode {
  id: string;
  url: string;
  title: string;
  type: 'page' | 'api' | 'modal' | 'redirect' | 'login';
  authRequired: boolean;
  authVerified: boolean;
  discoveredFrom: string | null;
  discoveryMethod: 'navigation' | 'click' | 'form_submit' | 'redirect' | 'script_navigation';
}

export interface WorkflowEdge {
  fromId: string;
  toId: string;
  trigger: 'click' | 'form_submit' | 'navigation' | 'redirect' | 'script';
  selector?: string;
  formData?: Record<string, string>;
  label: string;
}

// ── Endpoints ──

export interface AppModelEndpoint {
  path: string;
  method: string;
  params: Array<{ name: string; type: string; required: boolean }>;
  requiresAuth: boolean;
  responseStatus: number;
  contentType: string;
  bodyPreview: string;
  bodyFormat?: 'json' | 'xml' | 'form' | 'graphql';
  bodyFields?: Array<{ name: string; type: string }>;
  authHeaders?: Record<string, string>;
}

// ── Forms ──

export interface AppModelFormField {
  name: string;
  type: string;
  placeholder: string;
  required: boolean;
}

export interface AppModelForm {
  pageUrl: string;
  action: string;
  method: string;
  fields: AppModelFormField[];
}

// ── Scripts / Storage ──

export interface AppModelScript {
  src: string;
  async: boolean;
  defer: boolean;
}

// ── Findings ──

export interface FindingEvidence {
  type: 'text' | 'screenshot' | 'har_entry' | 'raw_request' | 'raw_response';
  data: string;
  label: string;
  timestamp: number;
  session?: string;
}

export interface AppModelFinding {
  id?: string;
  type: string;
  endpoint: string;
  param: string;
  method?: string;
  payload?: string;
  description?: string;
  evidence: FindingEvidence[];
  confidence: string | number;
  confirmed: boolean;
  severity: string;
}

// ── Parameter Classification ──

export interface ParameterClass {
  paramName: string;
  pageUrl: string;
  classifiedAs: 'id' | 'email' | 'password' | 'search' | 'price' | 'quantity' | 'name' | 'date' | 'file' | 'token' | 'unknown';
  attackHints: string[];
}

// ── Auth Boundary ──

export interface AuthBoundary {
  url: string;
  method: string;
  requiresAuth: boolean;
  authWith: 'cookie' | 'header' | 'token' | 'session';
  evidence: string;
}

// ── Navigation Entry ──

export interface NavigationEntry {
  fromUrl: string;
  toUrl: string;
  trigger: 'click' | 'form_submit' | 'navigation' | 'redirect' | 'script' | 'manual';
  timestamp: number;
}

// ── Browser Session Metadata ──

export interface BrowserSessionMeta {
  createdAt: number;
  currentUrl: string;
  recording: boolean;
  tracing: boolean;
  stepCount: number;
}

// ── Top-level Model ──

// ── Recon result shapes ──

export interface OAuthProvider {
  discoveryUrl: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  jwksUri?: string;
  responseTypesSupported?: string[];
  grantTypesSupported?: string[];
  scopesSupported?: string[];
  clientIds: string[];
  registeredClients: Array<{
    clientId: string;
    discoveredAt: number;
    source: 'discovery' | 'spider' | 'header';
  }>;
  discoveredAt: number;
  raw?: string;
}

export interface GraphQLEndpoint {
  url: string;
  method: 'POST' | 'GET';
  introspectionEnabled: boolean;
  typeCount: number;
  queryCount: number;
  mutationCount: number;
  fieldAuthzHints: Array<{ type: string; field: string; sensitivity: 'public' | 'user' | 'admin' }>;
  discoveredAt: number;
  evidence: string;
}

export interface JWTTokenInfo {
  source: 'cookie' | 'header' | 'localStorage' | 'sessionStorage' | 'response';
  sourceName: string;
  raw: string;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  expiresAt?: number;
  isExpired: boolean;
  algorithm: string;
  algorithmVulnerable: boolean;
  weakSecretSuspected: boolean;
  capturedAt: number;
}

export interface FrameworkInfo {
  name: string;
  version?: string;
  evidence: string;
  discoveredAt: number;
  hints: string[];
}

export interface CloudProbeResult {
  probeId: string;
  provider: 'aws' | 'gcp' | 'azure' | 'digitalocean' | 'oracle' | 'unknown';
  metadataUrl: string;
  surface: 'ssrf' | 'direct' | 'header' | 'dns';
  status: 'leaked' | 'blocked' | 'timeout' | 'unknown' | 'inconclusive';
  responseSnippet: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  discoveredAt: number;
}

export interface ReconLogEntry {
  timestamp: number;
  tool: 'oauth-discovery' | 'graphql-discovery' | 'jwt-discovery' | 'framework-fingerprint' | 'cloud-metadata-probe';
  target: string;
  status: 'found' | 'not-found' | 'error' | 'inconclusive';
  durationMs: number;
  detail: string;
}

export interface AttackChain {
  id: string;
  name: string;
  steps: Array<{
    step: number;
    findingType: string;
    endpoint: string;
    evidenceRef: string;
    description: string;
  }>;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: number;
  narrative: string;
  exploitability: 'trivial' | 'moderate' | 'difficult';
  discoveredAt: number;
}

export interface AppModel {
  target: string;
  techStack: string[];
  auth: {
    type: 'JWT' | 'session' | 'basic' | 'oauth' | 'none' | 'unknown';
    loginEndpoint: string;
    endpoints: string[];
    cookies: Record<string, string>;
    tokens: string[];
    sessions: Record<string, { label: string; filePath: string; savedAt: string; url: string }>;
    storageStatePath?: string;
    loginMethod?: string;
    loginFields?: string[];
    capturedAt?: number;
  };
  workflow: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  endpoints: AppModelEndpoint[];
  forms: AppModelForm[];
  scripts: AppModelScript[];
  cookies: Record<string, string>;
  localStorage: Record<string, string>;
  findings: AppModelFinding[];
  verifications: Array<{
    findingIndex: number;
    status: 'fixed' | 'regressed' | 'unchanged' | 'unknown';
    previousSeverity: string;
    newResponse: { status: number; bodyLength: number } | null;
    verifiedAt: string;
  }>;
  parameterClassifications: ParameterClass[];
  authBoundaries: AuthBoundary[];
  recordedSessions: Record<string, MacroStep[]>;
  hypotheses: Record<string, unknown>[];
  nextSteps: string[];
  visitedUrls: string[];
  oastCallbacks: Array<{ uuid: string; url: string; timestamp: number; method: string }>;
  workerActions: WorkerAction[];
  coverage: Array<{
    endpoint: string;
    method: string;
    param: string;
    status: 'tested' | 'skipped';
    reason: string;
    timestamp: number;
  }>;
  thinRoutes: Array<{
    url: string;
    path: string;
    title: string;
    initialScore: number;
    snapshotHash: string;
    discoveredAt: number;
  }>;
  currentPage: {
    url: string;
    title: string;
    lastUpdatedAt: number;
    snapshotHash: string;
  };
  warnings: Array<{ timestamp: number; message: string; source: string }>;
  eventLog: Array<{ timestamp: number; type: 'pagechange' | 'toolcall' | 'finding' | 'error' | 'navigation'; detail: string }>;
  artifacts: {
    harFiles: string[];
    screenshots: string[];
    traceFiles: string[];
  };
  browserSessions: Record<string, BrowserSessionMeta>;
  navigationHistory: NavigationEntry[];
  errors: Array<{ timestamp: number; type: string; message: string; url?: string }>;
  // ── New recon sections ──
  oauthProviders: OAuthProvider[];
  graphqlEndpoints: GraphQLEndpoint[];
  jwtTokens: JWTTokenInfo[];
  frameworks: FrameworkInfo[];
  cloudProbes: CloudProbeResult[];
  reconLog: ReconLogEntry[];
  attackChains: AttackChain[];
  _meta: {
    startedAt: number;
    duration: number;
    totalToolCalls: number;
    lastUpdatedAt: number;
    agentVersion: string;
  };
}

export type AppModelSection = keyof AppModel;

export const DEFAULT_MODEL: AppModel = {
  target: '',
  techStack: [],
  auth: { type: 'unknown', loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {}, storageStatePath: '', loginMethod: '', loginFields: [], capturedAt: 0 },
  workflow: { nodes: [], edges: [] },
  endpoints: [],
  forms: [],
  scripts: [],
  cookies: {},
  localStorage: {},
  findings: [],
  verifications: [],
  parameterClassifications: [],
  authBoundaries: [],
  recordedSessions: {},
  hypotheses: [],
  nextSteps: ['Navigate to target', 'Build workflow graph', 'Discover auth boundaries', 'Classify parameters', 'Probe for vulnerabilities'],
  visitedUrls: [],
  oastCallbacks: [],
  workerActions: [],
  coverage: [],
  thinRoutes: [],
  currentPage: { url: '', title: '', lastUpdatedAt: 0, snapshotHash: '' },
  warnings: [],
  eventLog: [],
  artifacts: { harFiles: [], screenshots: [], traceFiles: [] },
  browserSessions: {},
  navigationHistory: [],
  errors: [],
  oauthProviders: [],
  graphqlEndpoints: [],
  jwtTokens: [],
  frameworks: [],
  cloudProbes: [],
  reconLog: [],
  attackChains: [],
  _meta: { startedAt: 0, duration: 0, totalToolCalls: 0, lastUpdatedAt: 0, agentVersion: '' },
};

export interface WorkerAction {
  hypothesisId: string;
  technique: string;
  attempt: number;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  payload: string;
  status: number;
  responseBodySnippet: string;
  timingMs: number;
  vulnerable: boolean;
  evidence: string[];
  analysis: string;
  timestamp: number;
}

export function readAppModel(modelPath: string): AppModel {
  try {
    if (!fs.existsSync(modelPath)) return { ...DEFAULT_MODEL };
    const raw = fs.readFileSync(modelPath, 'utf-8');
    return deepMerge(DEFAULT_MODEL, JSON.parse(raw));
  } catch {
    return { ...DEFAULT_MODEL };
  }
}

const modelWriteLocks = new Map<string, Promise<void>>();

export async function writeAppModelAsync(modelPath: string, model: AppModel): Promise<void> {
  const prev = modelWriteLocks.get(modelPath) || Promise.resolve();
  const next = prev.then(() => new Promise<void>((resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      const tmpPath = modelPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(model, null, 2));
      fs.renameSync(tmpPath, modelPath);
      resolve();
    } catch (e) {
      reject(e);
    }
  })).catch(() => {});
  modelWriteLocks.set(modelPath, next);
  await next;
}

export function writeAppModel(modelPath: string, model: AppModel): void {
  fs.mkdirSync(path.dirname(modelPath), { recursive: true });
  const tmpPath = modelPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(model, null, 2));
  fs.renameSync(tmpPath, modelPath);
}

export function readAppModelSection(modelPath: string, section: AppModelSection): unknown {
  const model = readAppModel(modelPath);
  return model[section];
}

export function updateAppModelSection(modelPath: string, section: AppModelSection, data: unknown, merge = true): AppModel {
  const model = readAppModel(modelPath);
  if (merge && Array.isArray(model[section]) && Array.isArray(data)) {
    (model[section] as unknown[]) = mergeDedup(model[section] as unknown[], data as unknown[]);
  } else if (merge && typeof model[section] === 'object' && model[section] !== null && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    (model[section] as Record<string, unknown>) = { ...(model[section] as Record<string, unknown>), ...(data as Record<string, unknown>) };
  } else {
    (model[section] as unknown) = data;
  }
  const payload = JSON.stringify(model, null, 2);
  const prev = modelWriteLocks.get(modelPath) || Promise.resolve();
  const next = prev.then(() => new Promise<void>((resolve, reject) => {
    try {
      fs.mkdirSync(path.dirname(modelPath), { recursive: true });
      const tmpPath = modelPath + '.tmp';
      fs.writeFileSync(tmpPath, payload);
      fs.renameSync(tmpPath, modelPath);
      resolve();
    } catch (e) {
      reject(e);
    }
  })).catch((e) => { process.stderr.write(`[app-model] write error: ${String(e)}\n`); });
  modelWriteLocks.set(modelPath, next);
  return model;
}

export function updateAppModelSectionAsync(modelPath: string, section: AppModelSection, data: unknown, merge = true): Promise<AppModel> {
  const model = updateAppModelSection(modelPath, section, data, merge);
  const pending = modelWriteLocks.get(modelPath) || Promise.resolve();
  return pending.then(() => model);
}

// ── Risk Scoring ──

export function calculateOverallRisk(model: AppModel): { score: number; level: string; breakdown: Record<string, number> } {
  const weights: Record<string, number> = { critical: 10, high: 5, medium: 3, low: 1, info: 0 };
  const breakdown: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let totalWeight = 0;
  for (const f of model.findings) {
    const sev = f.severity || 'info';
    breakdown[sev] = (breakdown[sev] || 0) + 1;
    totalWeight += weights[sev] || 0;
  }
  const score = Math.min(100, Math.round((totalWeight / Math.max(model.endpoints.length, 1)) * 25));
  const level = score >= 70 ? 'critical' : score >= 40 ? 'high' : score >= 20 ? 'medium' : score >= 5 ? 'low' : 'info';
  return { score, level, breakdown };
}

// ── Workflow Graph Rendering ──

export function renderMermaidGraph(model: AppModel): string {
  const { nodes, edges } = model.workflow;
  if (nodes.length === 0) return '';
  const lines: string[] = ['graph TD;'];
  for (const node of nodes) {
    const safeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
    const label = (node.title || node.url || node.id).replace(/"/g, '\\"');
    const style = node.authRequired ? ':::.auth' : node.type === 'login' ? ':::.login' : '';
    lines.push(`  ${safeId}["${label}"]${style}`);
  }
  for (const edge of edges) {
    const from = edge.fromId.replace(/[^a-zA-Z0-9]/g, '_');
    const to = edge.toId.replace(/[^a-zA-Z0-9]/g, '_');
    const label = (edge.label || edge.trigger).replace(/"/g, '\\"');
    lines.push(`  ${from} -->|"${label}"| ${to};`);
  }
  return lines.join('\n');
}

export function renderWorkflowGraph(model: AppModel): string {
  const { nodes, edges } = model.workflow;
  if (nodes.length === 0) return 'Workflow graph is empty.';

  const lines: string[] = ['```mermaid', 'graph TD;'];
  for (const node of nodes) {
    const safeId = node.id.replace(/[^a-zA-Z0-9]/g, '_');
    const label = (node.title || node.url || node.id).replace(/"/g, '\\"');
    const style = node.authRequired ? ':::.auth' : node.type === 'login' ? ':::.login' : '';
    lines.push(`  ${safeId}["${label}"]${style}`);
  }
  for (const edge of edges) {
    const from = edge.fromId.replace(/[^a-zA-Z0-9]/g, '_');
    const to = edge.toId.replace(/[^a-zA-Z0-9]/g, '_');
    const label = (edge.label || edge.trigger).replace(/"/g, '\\"');
    lines.push(`  ${from} -->|"${label}"| ${to};`);
  }
  lines.push('```');
  lines.push('');
  lines.push(`**${nodes.length} nodes**, **${edges.length} edges**`);

  const visitedTargets = model.visitedUrls.length;
  const doneEndpoints = model.endpoints.length;
  const classifiedParams = model.parameterClassifications.length;
  lines.push(`- **Visited URLs**: ${visitedTargets}`);
  lines.push(`- **Discovered endpoints**: ${doneEndpoints}`);
  lines.push(`- **Classified parameters**: ${classifiedParams}`);
  lines.push(`- **Auth boundaries proven**: ${model.authBoundaries.length}`);

  return lines.join('\n');
}

// ── Report Compilation ──

export function compileReport(model: AppModel, format: 'html' | 'json' | 'markdown'): string {
  const risk = calculateOverallRisk(model);
  const findingsBySeverity: Record<string, AppModelFinding[]> = {};
  for (const f of model.findings) {
    const sev = f.severity || 'info';
    if (!findingsBySeverity[sev]) findingsBySeverity[sev] = [];
    findingsBySeverity[sev].push(f);
  }

  if (format === 'json') {
    return JSON.stringify({
      target: model.target,
      risk,
      summary: {
        totalFindings: model.findings.length,
        endpoints: model.endpoints.length,
        forms: model.forms.length,
        workflowNodes: model.workflow.nodes.length,
        workflowEdges: model.workflow.edges.length,
        visitedUrls: model.visitedUrls.length,
        parameterClassifications: model.parameterClassifications.length,
        authBoundaries: model.authBoundaries.length,
        recordedSessions: Object.keys(model.recordedSessions).length,
      },
      findingsBySeverity,
      techStack: model.techStack,
      generatedAt: new Date().toISOString(),
    }, null, 2);
  }

  if (format === 'html') {
    const findingRows = model.findings.map(f => `      <tr>
        <td>${f.type}</td>
        <td>${f.endpoint || '-'}</td>
        <td><span class="sev sev-${f.severity}">${f.severity.toUpperCase()}</span></td>
        <td>${f.confidence}</td>
        <td>${f.evidence.map(e => e.label).join('; ')}</td>
      </tr>`).join('\n');
    const mermaidGraph = renderMermaidGraph(model);
    const graphSection = mermaidGraph
      ? `<h2>Workflow Graph</h2>
<div class="mermaid">${mermaidGraph}</div>
<p>${model.workflow.nodes.length} nodes, ${model.workflow.edges.length} edges</p>`
      : '';
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Security Report — ${model.target}</title>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1a1a2e; background: #f8f9fa; }
  h1 { color: #16213e; border-bottom: 3px solid #e94560; padding-bottom: .5rem; }
  .risk { display: inline-block; padding: .25rem .75rem; border-radius: 4px; font-weight: 700; font-size: 1.1rem; }
  .risk-critical { background: #e94560; color: #fff; }
  .risk-high { background: #f39c12; color: #fff; }
  .risk-medium { background: #f1c40f; color: #1a1a2e; }
  .risk-low { background: #3498db; color: #fff; }
  .risk-info { background: #95a5a6; color: #fff; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #dee2e6; }
  th { background: #16213e; color: #fff; }
  .sev { font-size: .75rem; font-weight: 600; padding: .15rem .5rem; border-radius: 3px; }
  .sev-critical { background: #e94560; color: #fff; }
  .sev-high { background: #f39c12; color: #fff; }
  .sev-medium { background: #f1c40f; color: #1a1a2e; }
  .sev-low { background: #3498db; color: #fff; }
  .sev-info { background: #95a5a6; color: #fff; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .card { background: #fff; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); text-align: center; }
  .card .num { font-size: 2rem; font-weight: 700; color: #16213e; }
  .card .label { font-size: .8rem; color: #6c757d; }
  .mermaid { background: #fff; border-radius: 8px; padding: 1rem; margin: 1rem 0; overflow-x: auto; }
</style></head><body>
<h1>Security Assessment Report</h1>
<p><strong>Target:</strong> ${model.target}</p>
<p><strong>Generated:</strong> ${new Date().toISOString()}</p>
<h2>Risk Overview</h2>
<p><span class="risk risk-${risk.level}">${risk.level.toUpperCase()} — ${risk.score}/100</span></p>
<div class="grid">
  <div class="card"><div class="num">${risk.breakdown.critical}</div><div class="label">Critical</div></div>
  <div class="card"><div class="num">${risk.breakdown.high}</div><div class="label">High</div></div>
  <div class="card"><div class="num">${risk.breakdown.medium}</div><div class="label">Medium</div></div>
  <div class="card"><div class="num">${risk.breakdown.low}</div><div class="label">Low</div></div>
  <div class="card"><div class="num">${(risk.breakdown.info || 0)}</div><div class="label">Info</div></div>
</div>
<div class="grid">
  <div class="card"><div class="num">${model.endpoints.length}</div><div class="label">Endpoints</div></div>
  <div class="card"><div class="num">${model.workflow.nodes.length}</div><div class="label">Workflow Nodes</div></div>
  <div class="card"><div class="num">${model.workflow.edges.length}</div><div class="label">Edge</div></div>
  <div class="card"><div class="num">${model.parameterClassifications.length}</div><div class="label">Classified Params</div></div>
  <div class="card"><div class="num">${model.authBoundaries.length}</div><div class="label">Auth Boundaries</div></div>
</div>
<h2>Findings (${model.findings.length})</h2>
${model.findings.length === 0 ? '<p>No findings recorded.</p>' : `<table><thead><tr><th>Type</th><th>Endpoint</th><th>Severity</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>${findingRows}</tbody></table>`}
<h2>Tech Stack</h2>
<p>${model.techStack.length > 0 ? model.techStack.join(', ') : 'Not detected'}</p>
${graphSection}
</body></html>`;
  }

  // Markdown
  const findingMd = model.findings.map(f => `- **${f.severity.toUpperCase()}** — ${f.type} on \`${f.endpoint || '-'}\` (param: \`${f.param || '-'}\`, confidence: ${f.confidence})`).join('\n');
  const riskBadge = `**${risk.level.toUpperCase()}** (${risk.score}/100)`;
  return `# Security Assessment Report

**Target:** ${model.target}
**Generated:** ${new Date().toISOString()}

## Risk
${riskBadge}

| Severity | Count |
|----------|-------|
| Critical | ${risk.breakdown.critical} |
| High | ${risk.breakdown.high} |
| Medium | ${risk.breakdown.medium} |
| Low | ${risk.breakdown.low} |
| Info | ${risk.breakdown.info || 0} |

## Summary
- **Endpoints:** ${model.endpoints.length}
- **Forms:** ${model.forms.length}
- **Workflow Nodes:** ${model.workflow.nodes.length}
- **Workflow Edges:** ${model.workflow.edges.length}
- **Classified Parameters:** ${model.parameterClassifications.length}
- **Auth Boundaries:** ${model.authBoundaries.length}
- **Visited URLs:** ${model.visitedUrls.length}

## Tech Stack
${model.techStack.length > 0 ? model.techStack.join(', ') : 'Not detected'}

## Findings (${model.findings.length})
${model.findings.length === 0 ? 'No findings recorded.' : findingMd}

## Workflow Graph
${renderWorkflowGraph(model)}
`;
}

// ── Dedup Helpers ──

function mergeDedup<T>(existing: T[], incoming: T[]): T[] {
  const dedupKey = (item: unknown): string => {
    const obj = item as Record<string, unknown>;
    if (obj.id && typeof obj.id === 'string') return obj.id;
    if (obj.fromId && obj.toId && obj.trigger) return `${obj.fromId}|${obj.toId}|${obj.trigger}`;
    if (obj.path && obj.method) return `${obj.method}:${obj.path}`;
    if (obj.name && obj.pageUrl) return `${obj.pageUrl}:${obj.name}`;
    if (obj.paramName && obj.pageUrl) return `${obj.pageUrl}:${obj.paramName}`;
    if (obj.src) return obj.src as string;
    if (obj.url && obj.method) return `${obj.method}:${obj.url}`;
    if (obj.name) return obj.name as string;
    if (obj.url) return obj.url as string;
    return JSON.stringify(item);
  };

  const seen = new Set<string>();
  const merged = [...existing];
  for (const item of existing) seen.add(dedupKey(item));
  for (const item of incoming) {
    const key = dedupKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export interface FormattedCrawlContext {
  summary: string;
  isPrivateApp: boolean;
  privateAppReason: string;
}

export function formatAppModelContext(model: AppModel): FormattedCrawlContext {
  const lines: string[] = [];
  const nodes = model.workflow?.nodes || [];
  const edges = model.workflow?.edges || [];
  const endpoints = model.endpoints || [];
  const forms = model.forms || [];
  const auth = model.auth;
  const tech = model.techStack || [];
  const params = model.parameterClassifications || [];
  const boundaries = model.authBoundaries || [];
  const visited = model.visitedUrls || [];

  // Detect private app
  let isPrivateApp = false;
  let privateAppReason = '';
  const cookies = model.cookies || {};
  const cookieKeys = Object.keys(cookies);
  const hasAuthCookie = cookieKeys.some(
    (k) => /session|token|auth|sid|jwt|connect\.sid|phpsessid|jsessionid|ss?ion/i.test(k)
  );

  if (visited.length <= 1 && endpoints.length === 0) {
    isPrivateApp = true;
    privateAppReason = 'Crawl discovered 0–1 pages and no endpoints — likely behind authentication';
  } else if (nodes.length <= 1 && forms.length === 0) {
    isPrivateApp = true;
    privateAppReason = 'No workflow nodes or forms found — target may require login';
  } else if (auth.type !== 'none' && visited.length <= 2) {
    isPrivateApp = true;
    privateAppReason = `Auth type "${auth.type}" detected but only ${visited.length} pages crawled — login wall blocking exploration`;
  }

  if (hasAuthCookie && visited.length > 1) {
    isPrivateApp = false;
    privateAppReason = '';
  }

  if (isPrivateApp) {
    lines.push(`⚠️  PRIVATE APP DETECTED — ${privateAppReason}`);
    lines.push('');
    lines.push('The automated spider could not discover routes because the app likely requires authentication.');
    lines.push('Options to proceed:');
    if (auth.loginEndpoint) lines.push(`  • Login endpoint found: ${auth.loginEndpoint} — use browser to authenticate manually`);
    lines.push('  • Record a login session using /record in REPL or learn command');
    lines.push('  • Upload app specs: --with-openapi <file>, --with-har <file>, --with-postman <file>');
    lines.push('  • In the agent: navigate to login page, fill credentials manually via browser_session_fill');
    lines.push('');
  }

  // ── Target overview ──
  lines.push(`Target: ${model.target}`);
  if (tech.length > 0) lines.push(`Tech stack: ${tech.join(', ')}`);
  lines.push(`Auth: ${auth.type}${auth.loginEndpoint ? ` (login: ${auth.loginEndpoint})` : ''}`);
  lines.push('');

  // ── Workflow graph ──
  if (nodes.length > 0) {
    lines.push(`\nWorkflow Graph — ${nodes.length} nodes, ${edges.length} edges:`);
    for (const n of nodes.slice(0, 20)) {
      const authTag = n.authRequired ? ' 🔒' : '';
      lines.push(`  · ${n.title || n.url} [${n.type}]${authTag}`);
    }
    if (nodes.length > 20) lines.push(`  ... and ${nodes.length - 20} more nodes`);
    if (edges.length > 0) {
      lines.push(`\nTransitions (sample):`);
      for (const e of edges.slice(0, 10)) {
        const from = nodes.find(n => n.id === e.fromId)?.title || e.fromId;
        const to = nodes.find(n => n.id === e.toId)?.title || e.toId;
        lines.push(`  ${from} → ${to} [${e.trigger}]`);
      }
      if (edges.length > 10) lines.push(`  ... and ${edges.length - 10} more transitions`);
    }
  }

  // ── Endpoints ──
  if (endpoints.length > 0) {
    lines.push(`\nAPI Endpoints (${endpoints.length}):`);
    for (const ep of endpoints.slice(0, 25)) {
      const authTag = ep.requiresAuth ? ' 🔒' : '';
      const params = ep.params?.length > 0 ? ` params: ${ep.params.map(p => p.name).join(', ')}` : '';
      lines.push(`  ${ep.method.toUpperCase()} ${ep.path} → ${ep.responseStatus}${authTag}${params}`);
    }
    if (endpoints.length > 25) lines.push(`  ... and ${endpoints.length - 25} more endpoints`);
  }

  // ── Forms ──
  if (forms.length > 0) {
    lines.push(`\nForms (${forms.length}):`);
    for (const f of forms.slice(0, 15)) {
      const fields = f.fields.map(fi => `${fi.name}[${fi.type}]`).join(', ');
      lines.push(`  · ${f.pageUrl} → ${f.action} (${fields})`);
    }
    if (forms.length > 15) lines.push(`  ... and ${forms.length - 15} more forms`);
  }

  // ── Parameter classifications ──
  if (params.length > 0) {
    const byType: Record<string, string[]> = {};
    for (const p of params) {
      (byType[p.classifiedAs] ||= []).push(p.paramName);
    }
    lines.push(`\nParameter classifications:`);
    for (const [type, names] of Object.entries(byType)) {
      lines.push(`  · ${type}: ${names.join(', ')}`);
    }
  }

  // ── Auth boundaries ──
  const authUrls = boundaries.filter(b => b.requiresAuth);
  const publicUrls = boundaries.filter(b => !b.requiresAuth);
  if (authUrls.length > 0) {
    lines.push(`\nAuth boundaries — ${authUrls.length} protected, ${publicUrls.length} public:`);
    for (const b of authUrls.slice(0, 10)) {
      lines.push(`  🔒 ${b.method.toUpperCase()} ${b.url}`);
    }
    for (const b of publicUrls.slice(0, 5)) {
      lines.push(`  🔓 ${b.method.toUpperCase()} ${b.url}`);
    }
  }

  // ── Findings summary ──
  const findings = model.findings || [];
  if (findings.length > 0) {
    const bySev: Record<string, number> = {};
    for (const f of findings) {
      bySev[f.severity] = (bySev[f.severity] || 0) + 1;
    }
    lines.push(`\nExisting findings (${findings.length}):`);
    for (const [sev, count] of Object.entries(bySev)) {
      lines.push(`  · ${sev}: ${count}`);
    }
  }

  // ── Coverage ──
  const coverage = model.coverage || [];
  const tested = coverage.filter(c => c.status === 'tested').length;
  const skipped = coverage.filter(c => c.status === 'skipped').length;
  if (coverage.length > 0) {
    lines.push(`\nCoverage: ${tested} tested, ${skipped} skipped`);
  }

  // ── Cookies ──
  if (cookieKeys.length > 0) {
    lines.push(`\nCookies (${cookieKeys.length}):`);
    const sessionKeys = cookieKeys.filter((k) => /session|token|auth|sid|jwt|connect\.sid/i.test(k));
    if (sessionKeys.length > 0) {
      lines.push(`  Auth-relevant: ${sessionKeys.join(', ')}`);
    }
    const otherKeys = cookieKeys.filter((k) => !/session|token|auth|sid|jwt|connect\.sid/i.test(k));
    if (otherKeys.length > 0) {
      lines.push(`  Other: ${otherKeys.join(', ')}`);
    }
  }

  // ── LocalStorage ──
  const ls = model.localStorage || {};
  const lsKeys = Object.keys(ls);
  if (lsKeys.length > 0) {
    const tokenKeys = lsKeys.filter((k) => /token|jwt|auth|access.?token|refresh.?token/i.test(k));
    if (tokenKeys.length > 0) {
      lines.push(`\nLocalStorage: ${lsKeys.length} keys (${tokenKeys.length} auth-relevant)`);
    } else {
      lines.push(`\nLocalStorage: ${lsKeys.length} keys`);
    }
  }

  // ── Visited URLs ──
  if (visited.length > 0) {
    lines.push(`\nVisited URLs (${visited.length}):`);
    for (const url of visited.slice(0, 20)) {
      lines.push(`  · ${url}`);
    }
    if (visited.length > 20) lines.push(`  ... and ${visited.length - 20} more`);
  }

  return {
    summary: lines.join('\n'),
    isPrivateApp,
    privateAppReason,
  };
}
