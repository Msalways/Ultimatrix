# Phase 0 — Observability & Logging Setup

**Goal:** Replace chalk-based console.log with Mastra's PinoLogger + Observability. Every agent run, tool call, and workflow step produces structured JSON logs with trace correlation.

## Install

```bash
npm install @mastra/observability @mastra/loggers @mastra/libsql
```

## Tasks

### 0.1 Create `src/observability.ts`

Bootstrap a Mastra instance with logger + storage + observability:

```typescript
import { Mastra } from '@mastra/core/mastra'
import { PinoLogger } from '@mastra/loggers'
import { Observability, MastraStorageExporter } from '@mastra/observability'
import { LibSQLStore } from '@mastra/libsql'

let _mastra: Mastra | null = null

export function initObservability(): Mastra {
  if (_mastra) return _mastra
  _mastra = new Mastra({
    logger: new PinoLogger({
      name: 'ultimatrix',
      level: process.env.LOG_LEVEL || 'info',
    }),
    storage: new LibSQLStore({
      id: 'ultimatrix-storage',
      url: 'file:./ultimatrix.db',
    }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'ultimatrix',
          exporters: [new MastraStorageExporter()],
        },
      },
    }),
  })
  return _mastra
}

export function getMastra(): Mastra | null {
  return _mastra
}
```

### 0.2 Update `src/utils/logger.ts`

Replace chalk-based logger with PinoLogger. Keep the same public API (`log.info()`, `log.warn()`, `log.error()`, `log.success()`, `log.dim()`) so all existing callers work unchanged.

```typescript
import { PinoLogger } from '@mastra/loggers'

const pino = new PinoLogger({
  name: 'ultimatrix',
  level: process.env.LOG_LEVEL || 'info',
})

type Level = 'info' | 'success' | 'warn' | 'error' | 'dim'

const LEVEL_MAP: Record<Level, string> = {
  info: 'info',
  success: 'info',
  warn: 'warn',
  error: 'error',
  dim: 'debug',
}

export class Logger {
  private module?: string

  constructor(module?: string) {
    this.module = module
  }

  child(module: string): Logger {
    return new Logger(module)
  }

  private log(level: Level, msg: string, data?: Record<string, unknown>): void {
    const opts = this.module ? { module: this.module, ...data } : data
    pino[LEVEL_MAP[level]](opts || {}, msg)
  }

  info(msg: string, data?: Record<string, unknown>): void { this.log('info', msg, data) }
  success(msg: string, data?: Record<string, unknown>): void { this.log('success', `✔ ${msg}`, data) }
  warn(msg: string, data?: Record<string, unknown>): void { this.log('warn', `⚠ ${msg}`, data) }
  error(msg: string, data?: Record<string, unknown>): void { this.log('error', `✘ ${msg}`, data) }
  dim(msg: string, data?: Record<string, unknown>): void { this.log('dim', msg, data) }
}

export const log = new Logger()
```

### 0.3 Wire into `src/cli/index.ts`

At startup, call `initObservability()` before anything else. Pass mastra instance to `createSupervisor()` and workers.

### 0.4 Tool logging

In every tool's `execute` function, use `context?.mastra?.getLogger()` for structured logs with trace correlation:

```typescript
execute: async (inputData, context) => {
  const logger = context?.mastra?.getLogger()
  logger?.info('httpRequest called', { method, url })
  // ...
}
```

### 0.5 Update `src/manager/agent.ts`

Accept optional `mastra` parameter and pass to `Agent` constructor.

### 0.6 Update `src/workers/registry.ts`

Accept optional `mastra` parameter and pass to worker `Agent` constructors.

## Verification

```bash
npm run build && npx tsc --noEmit
```

No errors. Logs appear structured (JSON) instead of chalk-colored text.
