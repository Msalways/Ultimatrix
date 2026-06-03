// src/recon/graphql-discovery.ts
//
// Discovers GraphQL endpoints by:
//   1. Trying well-known paths (/graphql, /gql, /api/graphql, /v1/graphql, ...)
//   2. Sending an introspection query and recording the schema
//   3. Categorizing fields by sensitivity (public / user / admin) based on
//      field names (id, email, password, role, balance, etc.)
//
// Writes into `appModel.graphqlEndpoints[]`.

import { updateAppModelSection, type GraphQLEndpoint } from '../core/app-model';
import { logReconEntry } from './index';

const GRAPHQL_PATHS = [
  '/graphql',
  '/gql',
  '/api/graphql',
  '/api/gql',
  '/v1/graphql',
  '/v2/graphql',
  '/query',
  '/api/query',
  '/graphql/v1',
  '/internal/graphql',
];

const INTROSPECTION_QUERY = `{ __schema { queryType { name } mutationType { name } types { name kind fields { name type { name kind ofType { name kind } } } } } }`;

const SENSITIVE_FIELDS: Record<string, 'admin' | 'user' | 'public'> = {
  password: 'admin', secret: 'admin', apikey: 'admin', api_key: 'admin', token: 'admin',
  role: 'admin', roles: 'admin', permissions: 'admin', isadmin: 'admin', is_admin: 'admin',
  balance: 'user', salary: 'user', ssn: 'user', creditcard: 'user', credit_card: 'user',
  email: 'user', phone: 'user', address: 'user', birthdate: 'user', dob: 'user',
  username: 'user', userid: 'user', user_id: 'user', id: 'public', name: 'public',
  title: 'public', body: 'public', content: 'public', createdat: 'public', created_at: 'public',
};

const SENSITIVE_QUERIES: Record<string, 'admin' | 'user' | 'public'> = {
  users: 'user', user: 'user', me: 'user', profile: 'user', account: 'user',
  adminstats: 'admin', admin: 'admin', dashboard: 'admin', systeminfo: 'admin', internals: 'admin',
  posts: 'public', post: 'public', messages: 'user', message: 'user', publicinfo: 'public',
};

export async function runGraphqlDiscovery(
  target: string,
  appModelPath: string,
  timeoutMs: number = 5000,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<{ endpoints: GraphQLEndpoint[] }> {
  const start = Date.now();
  const origin = new URL(target).origin;
  const endpoints: GraphQLEndpoint[] = [];

  for (const p of GRAPHQL_PATHS) {
    const url = `${origin}${p}`;
    // try GET first (some implementations use GET)
    const getResult = await graphqlProbe(url, 'GET', timeoutMs, customHeaders, cookies);
    if (getResult) {
      endpoints.push(getResult);
      continue;
    }
    // fallback to POST
    const postResult = await graphqlProbe(url, 'POST', timeoutMs, customHeaders, cookies);
    if (postResult) {
      endpoints.push(postResult);
    }
  }

  if (endpoints.length > 0) {
    updateAppModelSection(appModelPath, 'graphqlEndpoints', endpoints);
  }

  logReconEntry(appModelPath, {
    tool: 'graphql-discovery',
    target,
    status: endpoints.length > 0 ? 'found' : 'not-found',
    durationMs: Date.now() - start,
    detail: `${endpoints.length} endpoint(s); ${endpoints.filter(e => e.introspectionEnabled).length} with introspection`,
  });

  return { endpoints };
}

async function graphqlProbe(
  url: string,
  method: 'GET' | 'POST',
  timeoutMs: number,
  customHeaders?: Record<string, string>,
  cookies?: Record<string, string>,
): Promise<GraphQLEndpoint | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    'user-agent': 'ultimatrix-recon/1.0',
    'accept': 'application/json',
    ...(customHeaders || {}),
  };
  if (cookies && Object.keys(cookies).length > 0) {
    headers['cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  try {
    let r: Response;
    if (method === 'GET') {
      headers['accept'] = 'text/html,application/json';
      r = await fetch(`${url}?query=${encodeURIComponent(INTROSPECTION_QUERY)}`, { signal: controller.signal, headers, redirect: 'manual' });
    } else {
      headers['content-type'] = 'application/json';
      r = await fetch(url, { signal: controller.signal, headers, method: 'POST', body: JSON.stringify({ query: INTROSPECTION_QUERY }), redirect: 'manual' });
    }
    if (r.status !== 200) return null;
    const body = await r.text();
    if (!body.includes('"data"') && !body.includes('"__schema"')) return null;
    const j = JSON.parse(body);
    if (!j.data || !j.data.__schema) return null;

    const types: Array<{ name: string; kind: string; fields?: Array<{ name: string; type: { name: string; kind: string; ofType?: { name: string; kind: string } } }> }> = j.data.__schema.types || [];
    const queryType: { name: string } = j.data.__schema.queryType || { name: '' };
    const mutationType: { name: string } = j.data.__schema.mutationType || { name: '' };

    const fieldAuthzHints: GraphQLEndpoint['fieldAuthzHints'] = [];
    let queryCount = 0;
    let mutationCount = 0;
    for (const t of types) {
      // treat missing kind as OBJECT (some minimal GraphQL servers omit it)
      if (t.kind && t.kind !== 'OBJECT') continue;
      if (!t.fields) continue;
      if (t.name.startsWith('__')) continue;
      if (t.name === queryType.name) {
        for (const f of t.fields) {
          queryCount++;
          const key = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const sensitivity = SENSITIVE_QUERIES[key] || 'public';
          fieldAuthzHints.push({ type: t.name, field: f.name, sensitivity });
        }
      } else if (t.name === mutationType.name) {
        for (const f of t.fields) {
          mutationCount++;
          const key = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const sensitivity = SENSITIVE_QUERIES[key] || 'public';
          fieldAuthzHints.push({ type: t.name, field: f.name, sensitivity });
        }
      } else {
        for (const f of t.fields) {
          const key = f.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          const sensitivity = SENSITIVE_FIELDS[key] || 'public';
          fieldAuthzHints.push({ type: t.name, field: f.name, sensitivity });
        }
      }
    }

    return {
      url,
      method,
      introspectionEnabled: true,
      typeCount: types.length,
      queryCount,
      mutationCount,
      fieldAuthzHints,
      discoveredAt: Date.now(),
      evidence: body.slice(0, 2048),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
