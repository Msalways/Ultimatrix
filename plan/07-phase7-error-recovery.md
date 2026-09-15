# Phase 7: Error Handling & Recovery - Specification

## Overview
Make the system resilient with graceful error handling, retry mechanisms, and user-friendly recovery.

## Tasks

### 7.1 Global Error Boundary (HIGH)

**New File:** `src/components/error-boundary.tsx`

```tsx
'use client';

import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Optionally reload or reset state
    window.location.reload();
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    const { closeSettings } = useUIStore.getState();
    closeSettings();
    // Navigate to home
    window.location.href = '/';
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center p-4 bg-zinc-950">
          <div className="max-w-md w-full text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-950/30">
              <AlertTriangle size={32} className="text-red-400" />
            </div>
            <h1 className="mb-2 text-lg font-semibold text-zinc-100">Something went wrong</h1>
            <p className="mb-4 text-sm text-zinc-500">
              An unexpected error occurred. Your session data has been preserved.
            </p>
            <details className="mb-4 text-left max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 font-mono">
              <summary className="cursor-pointer text-zinc-500">Error details</summary>
              <pre>{this.state.error?.stack}</pre>
            </details>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="flex-1 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <RefreshCw size={14} className="mr-1" /> Try Again
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-600"
              >
                <Home size={14} className="mr-1" /> Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

**Usage in `src/app/home-client.tsx`:**
```tsx
import { ErrorBoundary } from '@/components/error-boundary';

export default function HomeClient() {
  return (
    <ErrorBoundary>
      <HomeClientInner />
    </ErrorBoundary>
  );
}

function HomeClientInner() { ... }
```

---

### 7.2 Retry Actions for Failed Operations (HIGH)

**Files:** `src/components/chat-stream.tsx`, `src/app/api/*`

**Implementation:**
```tsx
// In error messages, add retry button
{errorMessage.retryable && (
  <button
    onClick={() => handleSend(errorMessage.goal, errorMessage.mode)}
    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-900/70 px-2 text-[11px] text-red-200 transition-colors hover:bg-red-950/60"
  >
    <RotateCcw size={11} />
    Retry
  </button>
}
```

**For API routes:**
```typescript
// In API routes, return structured error with retry info
return new Response(JSON.stringify({ 
  error: message, 
  retryable: true,
  goal: originalGoal,
  mode: originalMode 
}), {
  status: 500,
  headers: { 'Content-Type': 'application/json' }
});
```

---

### 7.3 Offline Detection & Queue (MEDIUM)

**File:** `src/services/data-fetcher.ts`

```typescript
export class DataFetcher {
  private offlineQueue: Array<() => Promise<void>> = [];
  private isOnline = true;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.processQueue());
      window.addEventListener('offline', () => { this.isOnline = false; });
    }
  }

  async fetchWithQueue<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    if (!this.isOnline) {
      // Queue for later
      return new Promise((resolve, reject) => {
        this.offlineQueue.push(async () => {
          try {
            const result = await fetcher();
            resolve(result);
          } catch (e) {
            reject(e);
          }
        });
      });
    }
    return fetcher();
  }

  private async processQueue() {
    this.isOnline = true;
    while (this.offlineQueue.length > 0) {
      const task = this.offlineQueue.shift();
      if (task) await task();
    }
  }
}
```

**UI Indicator:**
```tsx
// In status bar or header
{!isOnline && (
  <div className="fixed bottom-4 right-4 z-50 animate-slide-in">
    <div className="flex items-center gap-2 rounded-md border border-amber-800 bg-amber-950/50 px-3 py-2 text-amber-300 text-sm">
      <WifiOff size={14} />
      <span>Offline - changes queued</span>
    </div>
  </div>
)}
```

---

### 7.4 Graceful Degradation for Quota (MEDIUM)

**File:** `src/models/middleware.ts`

**Current:** Throws error on quota exhaustion

**Target:**
```typescript
// In wrapModel, when quota exhausted:
if (quotaError) {
  // Don't throw - return degraded response
  return {
    ok: false,
    error: quotaError.message,
    degraded: true,
    degradedReason: 'QUOTA_EXHAUSTED',
    suggestion: 'Switch provider or wait for cooldown. See ultimatrix ratelimit status.'
  };
}
```

**In solver:**
```typescript
case 'tool-result':
  if (!toolOk && result?.degraded) {
    // Don't fail the turn, just record degradation
    evidence.recordToolOutput({
      type: 'degraded',
      data: result.degradedReason,
      label: `Degraded: ${toolName}`,
      observed: { degradation: result.degradedReason }
    });
    // Continue with other tools
  }
```

---

### 7.4 "Report Issue" Button (LOW)

**File:** `src/components/chat-stream.tsx`

```tsx
// Add to error messages and summary messages
{message.type === 'error' && (
  <button
    onClick={() => reportIssue(message)}
    className="ml-2 text-xs text-zinc-500 hover:text-zinc-300 underline"
  >
    Report Issue
  </button>
}

const reportIssue = async (message: ErrorMessage) => {
  const issue = {
    title: `Error: ${message.content.slice(0, 50)}`,
    body: `## Error\n${message.content}\n\n## Context\n- Target: ${activeTarget}\n- Mode: ${mode}\n- Timestamp: ${new Date(message.timestamp).toISOString()}\n- Goal: ${goal}\n\n## Stack\n\`\`\`\n${message.stack || 'N/A'}\n\`\`\``,
    labels: ['bug', 'auto-reported']
  };
  
  // Open GitHub issue or copy to clipboard
  navigator.clipboard.writeText(JSON.stringify(issue, null, 2));
  toast.success('Issue details copied to clipboard');
};
```

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Global error boundary catches crashes | ⬜ |
| Retry button on failed operations | ⬜ |
| Offline detection & queue | ⬜ |
| Graceful quota degradation | ⬜ |
| "Report Issue" button on errors | ⬜ |
| Error boundary shows stack trace | ⬜ |
| Retry works for failed tools | ⬜ |
| Offline indicator visible | ⬜ |
| Quota degradation continues turn | ⬜ |
| All 2226 tests pass | ⬜ |
| Clean TypeScript build | ⬜ |
| Clean build (ESM, CJS, DTS) | ⬜ |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/components/error-boundary.tsx` | CREATE |
| `src/components/chat-stream.tsx` | MODIFY - Retry buttons |
| `src/services/data-fetcher.ts` | MODIFY - Offline queue |
| `src/models/middleware.ts` | MODIFY - Graceful degradation |
| `src/solver/solver.ts` | MODIFY - Handle degraded results |
| `src/components/chat-stream.tsx` | MODIFY - Report issue button |

---

## Test Plan

- [ ] Simulate JS error, verify error boundary catches it
- [ ] Simulate tool failure, verify retry button works
- [ ] Disconnect network, verify offline queue works
- [ ] Exhaust quota, verify graceful degradation
- [ ] Click "Report Issue", verify clipboard copy
- [ ] All 2226 tests pass
- [ ] Clean TypeScript build
- [ ] Clean build (ESM, CJS, DTS)