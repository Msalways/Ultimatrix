# Phase 3 — LLM as Brain (Dynamic Payloads)

**Goal:** No hardcoded payloads anywhere. LLM dynamically crafts payloads for each endpoint's specific dimensions. New `recordTestCase` tool for proactive test generation.

## Tasks

### 3.1 `src/tools/injection-tools.ts`

**Delete this file.** `injectInContext` is removed. LLM uses `httpRequest` directly.

### 3.2 `src/tools/registry.ts`

Remove `injectInContext` export.

### 3.3 NEW: `src/tools/record-test-case.ts`

Create `recordTestCase` tool:

```typescript
recordTestCase({
  type: 'security' | 'happy' | 'sad' | 'edge' | 'auth',
  name: string,
  endpoint: {
    method: string,
    url: string,
    queryParams?: Record<string, string>,
    pathParams?: Record<string, string>,
    headers?: Record<string, string>,
    body?: any,
    cookies?: Record<string, string>,
  },
  payload: Record<string, any>,  // LLM crafts this
  expected: string,
  tags: string[],
  pageUrl?: string,
})
```

Writes to:
- **Graph** → `addTest(...)` creates Test node + `HAS_TEST` edge
- **Recorder** → streams Playwright code to `output/recordings/<page>/<name>.spec.ts`
- **Logger** → structured log entry with full payload

### 3.4 `src/tools/registry.ts`

Add `recordTestCase` to exports.

### 3.5 `src/manager/instructions.ts`

Add test generation section:
- "When you discover a page/form/endpoint, identify ALL input dimensions"
- "For each dimension, generate happy/sad/edge/security/auth test cases"
- "Use `recordTestCase` to save each scenario"
- "Pay attention to query params, path params, headers, body fields, cookies"
- "Be creative with payloads — try XSS, SQLi, edge cases based on endpoint context"

### 3.6 Worker instructions (all 4 files)

Remove hardcoded payload examples:
- `injection.ts`: Remove `"<script>alert(1)</script>"`, `"' OR 1=1--"` examples
- `auth-control.ts`: Remove JWT algorithm confusion examples
- `advanced.ts`: Remove race condition examples
- `recon.ts`: Remove command/clean

Replace with: "Craft payloads dynamically based on endpoint context."

### 3.7 `src/tools/observation-tools.ts`

Remove hardcoded payload mentions from tool descriptions (e.g., `evaluateRendered` description no longer needs to mention `<script>` tag).

### 3.8 `src/graph/schema.ts`

Ensure `Test` node type supports:
- `endpoint` field (method, url, params)
- `payload` field (the LLM-crafted data)
- `tags` field for categorization
- `dimension` field (query/body/headers/path/cookies)

### 3.9 `src/recorder/codegen.ts`

Add `apiRequestContext` Playwright code generation:

```typescript
test('SQL injection in email field - security', async ({ request }) => {
  const response = await request.post('/api/login', {
    data: { email: "' OR 1=1--", password: "test" }
  })
  expect(response.status()).toBeOneOf([400, 401, 403, 500])
})
```

## Verification

```bash
npm run build && ultimatrix -t https://example.com
```

In chat: "analyze /api/users"
Expected: LLM identifies endpoint dimensions, generates test cases for each. `output/recordings/` has .spec.ts files with dynamic payloads.
