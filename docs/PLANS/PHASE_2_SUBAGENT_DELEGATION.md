# Phase 2 — Sub-agent Delegation

**Goal:** Supervisor delegates to workers via Mastra's native `agents` config. Custom `delegateToWorker` tool removed. Mastra auto-creates `agent-injection`, `agent-authControl`, `agent-advanced`, `agent-recon` tools.

## Tasks

### 2.1 `src/manager/agent.ts`

Add `agents` config to Agent constructor:

```typescript
export function createSupervisor(config: UltimatrixConfig, mastra?: Mastra, browser?: AgentBrowser) {
  const agents = {
    injection: createInjectionWorker(modelConfig, stagehandBrowser, memory, recorder),
    authControl: createAuthControlWorker(modelConfig, stagehandBrowser, memory, recorder),
    advanced: createAdvancedWorker(modelConfig, stagehandBrowser, memory, recorder),
    recon: createReconWorker(modelConfig, stagehandBrowser, memory, recorder),
  }

  return new Agent({
    id: 'ultimatrix-supervisor',
    browser,
    agents,
    // ...
  })
}
```

Workers are created eagerly here (not lazy like delegate-tool). They share the Mastra Memory instance.

### 2.2 `src/manager/instructions.ts`

Convert to `getSupervisorInstructions(target?: string)`. Add delegation instructions:
- "Use `agent-injection` for XSS, SQLi, WAF bypass tasks"
- "Use `agent-authControl` for IDOR, JWT, OAuth tasks"
- "Use `agent-advanced` for race, logic, GraphQL tasks"
- "Use `agent-recon` for discovery, fingerprinting tasks"

### 2.3 `src/tools/delegate-tool.ts`

**Delete this file.** Mastra's `agents` config handles delegation natively.

### 2.4 `src/tools/registry.ts`

Remove `delegateToWorker` from imports and exports. Remove `registerAllTools()` since tools are registered per-agent now.

### 2.5 `src/workers/registry.ts`

Export individual worker factory functions:

```typescript
export { createInjectionWorker }
export { createAuthControlWorker }
export { createAdvancedWorker }
export { createReconWorker }
```

### 2.6 `src/cli/index.ts`

- Remove `setSharedWorkers()` call
- Remove `delegateTool` import
- Workers are created inside `createSupervisor()` via `agents` config

## Verification

```bash
npm run build && ultimatrix -t https://example.com
```

In chat: "test /api/login for SQLi"
Expected: Supervisor delegates to `agent-injection`, result comes back. Logs show delegation trace.
