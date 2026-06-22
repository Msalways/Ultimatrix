# Phase 4 — Record Everything

**Goal:** Every tool call — `httpRequest`, `browser_*`, `stagehand_*` — produces a Playwright test case. Spider crawl actions also recorded. API calls produce `apiRequestContext`-based Playwright tests.

## Tasks

### 4.1 `src/spider/agent.ts`

Wrap spider tools with recorder (same pattern as workers):

```typescript
const tools = { stagehandAct, stagehandExtract, updateGraph, getOastUrlTool }
const wrapped = recorder ? wrapAllMastraTools(tools, recorder) : tools
```

### 4.2 `src/tools/http-tools.ts`

Wrap `httpRequest`'s execute function with the recorder:

```typescript
execute: async (inputData, context) => {
  const logger = context?.mastra?.getLogger()
  const startTime = Date.now()
  // ... existing http logic ...
  const duration = Date.now() - startTime
  recordForTool('httpRequest', [inputData], response, recorder, InteractionType.API_CALL, duration)
  logger?.info('httpRequest', { method: inputData.method, url: inputData.url, status: response.status, duration })
  return response
}
```

### 4.3 `src/recorder/interaction.ts`

Add `API_CALL` to `InteractionType` enum:

```typescript
export enum InteractionType {
  GOTO = 'GOTO',
  CLICK = 'CLICK',
  FILL = 'FILL',
  ASSERT = 'ASSERT',
  EXTRACT = 'EXTRACT',
  ACT = 'ACT',
  DELEGATE = 'DELEGATE',
  EVALUATE = 'EVALUATE',
  SNAPSHOT = 'SNAPSHOT',
  API_CALL = 'API_CALL',  // NEW
}
```

### 4.4 `src/recorder/tool-wrapper.ts`

Add `httpRequest` → `API_CALL` mapping in `recordForTool()`:

```typescript
case 'httpRequest': {
  const { method, url, body, headers } = arg0
  recorder.record(InteractionType.API_CALL, `${method} ${url}`, {
    url,
    value: JSON.stringify({ method, body, headers }),
  })
  break
}
```

### 4.5 `src/recorder/codegen.ts`

Add `apiRequestContext` test generation for `API_CALL` interactions:

```typescript
if (interaction.type === InteractionType.API_CALL) {
  const { method, url, body, headers } = parseInteraction(interaction)
  lines.push(`  const response = await request.${method.toLowerCase()}('${url}', {`)
  if (body) lines.push(`    data: ${body},`)
  if (headers) lines.push(`    headers: ${JSON.stringify(headers)},`)
  lines.push(`  })`)
  lines.push(`  expect(response.status()).toBeDefined()`)
}
```

### 4.6 `src/tools/record-test-case.ts`

Wire `recordTestCase` to also stream to the recorder's output file.

## Verification

```bash
npm run build && ultimatrix -t https://example.com
```

Check `output/recordings/<session>/*.spec.ts`:
- Browser actions (`page.goto`, `page.click`, `page.fill`)
- API calls (`request.post`, `request.get`)
- Spider actions
- Standalone Playwright tests: `npx playwright test output/recordings/*.spec.ts`
