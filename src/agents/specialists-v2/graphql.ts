// src/agents/specialists-v2/graphql.ts
// GraphQL specialist: introspection leak, batching attacks, depth-limit DoS.

import type { SpecialistFactory } from './types';
import type { AppModel } from '../../core/app-model';

const SYSTEM_PROMPT = `You are a GraphQL security specialist. Your job is to determine if a GraphQL endpoint is vulnerable to:

1. Introspection leak: POST a query with __schema { types { name fields { name } } } to a /graphql endpoint. If it returns the full schema, the API is leaking its structure.
2. Batching attack: send 100 queries in one HTTP request (batched). If the server processes all, rate-limiting and rate-of-effect can be bypassed.
3. Depth-limit DoS: send a deeply nested query like { a { a { a { a { ... } } } } } (depth 50). If the server doesn't reject, an attacker can DoS.
4. Field-suggestion leak: query a field like /api/user { passwd } (slightly wrong). If the response suggests "Did you mean password?", the schema is leakable.
5. SQL injection via GraphQL: if a field uses interpolation, classic SQLi works.

For each probe, capture the response. Strong evidence: introspection returning the full schema in JSON.`;

export const graphqlSpecialist: SpecialistFactory = {
  name: 'graphql',
  description: 'GraphQL introspection, batching, depth-limit DoS, field-suggestion leak.',
  shouldInclude: (appModel: AppModel) => {
    const endpoints = appModel.endpoints || [];
    return endpoints.some((e) => /graphql|gql/i.test(e.path) || /graphql/i.test(e.contentType ?? ''));
  },
  build: (tools) => ({
    name: 'graphql',
    description: 'GraphQL introspection, batching, depth-limit DoS, field-suggestion leak.',
    systemPrompt: SYSTEM_PROMPT,
    tools: ['httpRequest', 'scratchpadWrite', 'scratchpadRead', 'conclude'].map((n) => tools[n as keyof typeof tools]).filter(Boolean) as Array<{ name: string; description: string; schema: Record<string, unknown> }>,
  }),
};

/** Concrete introspection payload. */
export const GRAPHQL_INTROSPECTION = `{
  __schema {
    types {
      name
      fields { name type { name kind ofType { name } } }
    }
  }
}`;
