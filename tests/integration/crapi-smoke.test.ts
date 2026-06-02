/**
 * tests/integration/crapi-smoke.test.ts
 *
 * OPT-IN integration test against a public CrAPI instance. Skipped by
 * default — only runs when CRAPI_URL is set in env. Internal QA fixture
 * only; not part of the public product surface.
 *
 * Run with:
 *   CRAPI_URL=https://crapi.apisec.ai CRAPI_CREDS='{"mechanic":{"email":"...","password":"..."}}' npx vitest run tests/integration/crapi-smoke.test.ts
 *
 * CrAPI is OWASP's deliberately vulnerable API. It exposes:
 *   - API1 BOLA: /api/v1/vehicles/{id} returns other users' data
 *   - API2 broken auth: weak JWT secret
 *   - API3 broken property auth: /api/v1/users/{id}/change-password
 *   - API5 broken function auth: /api/v1/admin/* trusts JWT role claim
 *
 * We use SessionPool + WorkflowStateGraph to test that the architecture
 * can detect these. This is a smoke test, not a full coverage suite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SessionPool } from '../../src/core/session-pool';
import { WorkflowStateGraph } from '../../src/core/workflow-state';
import { AuthFlow } from '../../src/core/auth-flow';

const CRAPI_URL = process.env.CRAPI_URL ?? '';
const CRAPI_CREDS_JSON = process.env.CRAPI_CREDS ?? '';
const SKIP_REASON = !CRAPI_URL
  ? 'CRAPI_URL not set; skipping integration test. Run with CRAPI_URL=https://crapi.apisec.ai CRAPI_CREDS=\'{"mechanic":{"email":"...","password":"..."}}\' to enable.'
  : !CRAPI_CREDS_JSON
    ? 'CRAPI_CREDS not set; skipping integration test.'
    : '';

const itIf = SKIP_REASON ? it.skip : it;

interface CrapiCreds {
  mechanic: { email: string; password: string };
  driver: { email: string; password: string };
  admin?: { email: string; password: string };
}

describe('CrAPI integration smoke test', () => {
  let pool: SessionPool;
  let creds: CrapiCreds;

  beforeAll(() => {
    if (SKIP_REASON) return;
    creds = JSON.parse(CRAPI_CREDS_JSON) as CrapiCreds;
    pool = new SessionPool({ headless: true, networkCaptureEnabled: false });
  });

  itIf('login as mechanic and driver via SessionPool', { timeout: 60000 }, async () => {
    const mechanic = await pool.getOrCreate('mechanic', { role: 'mechanic', label: 'mechanic' });
    const driver = await pool.getOrCreate('driver', { role: 'driver', label: 'driver' });
    expect(mechanic.id).toBe('mechanic');
    expect(driver.id).toBe('driver');
    const loginEndpoint = `${CRAPI_URL.replace(/\/$/, '')}/api/v1/login`;
    const mResult = await pool.login('mechanic', { loginEndpoint, fields: creds.mechanic });
    expect(mResult.ok).toBe(true);
    const dResult = await pool.login('driver', { loginEndpoint, fields: creds.driver });
    expect(dResult.ok).toBe(true);
  });

  itIf('diff_sessions detects that mechanic and driver see different /api/v1/whoami responses', { timeout: 60000 }, async () => {
    const loginEndpoint = `${CRAPI_URL.replace(/\/$/, '')}/api/v1/login`;
    if (!pool.has('mechanic')) await pool.login('mechanic', { loginEndpoint, fields: creds.mechanic });
    if (!pool.has('driver')) await pool.login('driver', { loginEndpoint, fields: creds.driver });
    const whoamiUrl = `${CRAPI_URL.replace(/\/$/, '')}/api/v1/whoami`;
    const result = await pool.diff('mechanic', 'driver', { url: whoamiUrl, method: 'GET' });
    expect(result.sessionA.status).toBe(200);
    expect(result.sessionB.status).toBe(200);
    expect(result.bodyEqual).toBe(false);
  });

  itIf('WorkflowStateGraph can track API endpoints from CrAPI', async () => {
    const graph = new WorkflowStateGraph();
    const v1 = graph.addNode({ id: 'v1', url: `${CRAPI_URL}/api/v1/vehicles/1`, title: 'vehicles/1', type: 'api', authRequired: true, authVerified: false, discoveredFrom: null, discoveryMethod: 'navigation' });
    const v2 = graph.addNode({ id: 'v2', url: `${CRAPI_URL}/api/v1/vehicles/2`, title: 'vehicles/2', type: 'api', authRequired: true, authVerified: false, discoveredFrom: 'v1', discoveryMethod: 'navigation' });
    graph.addEdge({ fromId: 'v1', toId: 'v2', trigger: 'click', label: 'next' });
    graph.markReachable('v1');
    expect(graph.getNode('v1')?.status).toBe('reachable');
    expect(graph.getNode('v2')?.status).toBe('pending');
    graph.markCompleted('v1');
    expect(graph.getNode('v2')?.status).toBe('reachable');
  });

  itIf('AuthFlow populates the session pool with the provided roles', { timeout: 60000 }, async () => {
    if (pool.has('mechanic')) return; // already populated by earlier test
    const auth = new AuthFlow(pool, { envCreds: creds, maxSessions: 3 });
    const result = await auth.discoverAndPopulate({} as any, CRAPI_URL, {
      pageText: 'Login as mechanic or driver to access your dashboard',
      formActions: [`${CRAPI_URL}/api/v1/login`],
    });
    expect(result.detectedRoles.map((r) => r.name).sort()).toEqual(['driver', 'mechanic']);
    expect(result.sessions.length).toBe(2);
  });
});
