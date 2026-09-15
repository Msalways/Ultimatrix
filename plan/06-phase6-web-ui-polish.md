# Phase 6: Web UI Polish - Specification

## Overview
Polish the Web UI to production quality - fix message jumping, format tool calls, add search, improve progress feedback.

## Tasks

### 6.1 Fix Message Jumping in Chat Stream (CRITICAL)

**File:** `src/components/chat-stream.tsx`

**Problem:** Messages jump/reorder during streaming due to unstable keys and live preview replacement.

**Root Cause:**
- Live answer preview (`liveAnswerId`) and final answer create duplicate/conflicting messages
- Message keys not stable during streaming
- `removeMessage` + `addMessage` causes re-renders

**Solution:**
```typescript
// Use stable message IDs throughout streaming
// Keep live preview as single message that transitions to final
// Don't remove/add - update in place

// Key fix: Use stable message.id throughout lifecycle
// Live preview: same message.id, update content in place
// Final answer: update same message, don't remove/add

// In handleSend:
const answerMessageId = nextId();
addMessage({ id: answerMessageId, role: 'assistant', content: '', streaming: true });

// During streaming - update same message:
updateMessage(answerMessageId, { content: visibleAnswer, streaming: true });

// On done:
updateMessage(answerMessageId, { content: finalContent, streaming: false });
```

**Key Changes:**
1. Single message ID for entire answer lifecycle
2. Update in place, never remove/add for same logical message
2. Stable keys for all messages

---

### 6.2 Format Tool Calls (Not Raw JSON) - CRITICAL

**File:** `src/components/tool-call-card.tsx`

**Current:** Raw JSON in expanded view

**Target:**
- Syntax-highlighted JSON
- Collapsible sections
- Copy button
- Arguments as formatted key-value pairs
- Result formatted with syntax highlighting

**Implementation:**
```tsx
// Add syntax highlighter (simple)
const formatJson = (obj: unknown) => JSON.stringify(obj, null, 2);

// Add copy button
<button onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}>
  <Copy size={12} />
</button>

// Collapsible sections for large results
<details>
  <summary>Result ({result.length} chars)</summary>
  <pre>{formatJson(result)}</pre>
</details>

// Format arguments nicely
{message.args && Object.keys(message.args).length > 0 && (
  <div className="mt-2 grid gap-1 text-xs">
    {Object.entries(message.args).map(([k, v]) => (
      <div key={k} className="flex gap-2">
        <span className="font-mono text-zinc-500">{k}:</span>
        <code className="text-zinc-400">{typeof v === 'string' ? v.slice(0, 100) : JSON.stringify(v).slice(0, 100)}</code>
      </div>
    ))}
  </div>
)}

```

---

### 6.3 Message Search (Ctrl+K) - HIGH

**File:** `src/components/chat-stream.tsx`

```tsx
const [searchQuery, setSearchQuery] = useState('');
const [showSearch, setShowSearch] = useState(false);

const filteredMessages = useMemo(() => 
  messages.filter(m => 
    m.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.name?.toLowerCase().includes(searchQuery.toLowerCase())
  ), [messages, searchQuery]);

// Keyboard shortcut
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setShowSearch(!showSearch);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

**UI:**
```tsx
{showSearch && (
  <div className="fixed top-4 right-4 z-50 w-80">
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
      <input
        type="text"
        placeholder="Search messages... (Ctrl+K)"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        className="w-full px-3 py-2 pl-10 rounded-md border border-zinc-700 bg-zinc-900 text-white"
        autoFocus
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">
        {filteredMessages.length} results
      </span>
    </div>
  )}
```

**Filtered rendering:**
```tsx
{messages.map((msg, i) => (
  searchQuery && !matchesSearch(msg) ? null : (
    <MessageBubble key={msg.id} message={msg} ... />
  ))
)}
```

---

### 6.4 Progress Indicators for Long Operations

**File:** `src/components/chat-stream.tsx`

**Add to stream-status message:**
```tsx
{isStreaming && (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 shadow-lg">
    <Loader2 size={14} className="animate-spin text-emerald-400" />
    <span className="text-sm text-zinc-300">{currentOperation}</span>
    <span className="text-xs text-zinc-500">{elapsed}s</span>
  </div>
)}
```

**Track elapsed time:**
```tsx
const [elapsed, setElapsed] = useState(0);
useEffect(() => {
  if (!isStreaming) return;
  const interval = setInterval(() => setElapsed(e => e + 1), 1000);
  return () => clearInterval(interval);
}, [isStreaming]);
```

---

### 6.5 Budget Panel Component (HIGH)

**New File:** `src/components/budget-panel.tsx`

```tsx
export function BudgetPanel() {
  const { 
    toolCallsCount, 
    maxToolCalls,
    tokensUsed, 
    tokensMax,
    phase,
    isRunning 
  } = useBudgetStore();
  
  const callsPct = maxToolCalls > 0 ? (toolCallsCount / maxToolCalls) * 100 : 0;
  const tokensPct = tokensMax > 0 ? (tokensUsed / tokensMax) * 100 : 0;
  const isWarning = callsPct >= 80 || tokensPct >= 80;
  const isCritical = callsPct >= 95 || tokensPct >= 95;
  
  return (
    <div className="relative">
      <button onClick={() => setShowDetail(!showDetail)} className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(callsPct, 100)}%` }}
            />
          </div>
          <span className="text-xs text-zinc-500">
            {toolCallsCount} / {maxToolCalls} calls
          </span>
        </div>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      
      {showDetail && (
        <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg z-50">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span>Calls</span>
              <span>{toolCallsCount} / {maxToolCalls}</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens</span>
              <span>{Math.round(tokensUsed/1000)}k / {Math.round(tokensMax/1000)}k</span>
            </div>
            <div className="flex justify-between">
              <span>Duration</span>
              <span>{formatDuration(durationMs)}</span>
            </div>
            <div className="flex justify-between">
              <span>Findings</span>
              <span>{findingsCount}</span>
            </div>
            {isWarning && (
              <div className="text-amber-400 text-xs">
                ⚠️ Approaching budget limit
              </div>
            )}
            {isCritical && (
              <div className="text-red-400 text-xs">
                🔴 Budget nearly exhausted
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Integration:** Add to `src/components/status-bar.tsx` and `src/components/chat-stream.tsx`

---

### 6.6 Graph Panel Filtering (MEDIUM)

**File:** `src/components/graph-panel.tsx`

**Add filtering/search:**
```tsx
const [filter, setFilter] = useState('');
const [typeFilter, setTypeFilter] = useState<string[]>([]);

const filteredNodes = useMemo(() => 
  data?.nodes.filter(node => {
    if (filter && !node.label?.toLowerCase().includes(filter.toLowerCase())) return false;
    if (typeFilter.length && !typeFilter.includes(node.type)) return false;
    return true;
  }) || [], [data, filter, typeFilter]);

// UI
<div className="flex gap-2 mb-4 p-2 border-b border-zinc-800">
  <input 
    placeholder="Filter nodes..." 
    value={filter} 
    onChange={e => setFilter(e.target.value)}
    className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-sm"
  />
  <select 
    value={typeFilter.join(',')} 
    onChange={e => setTypeFilter(e.target.value.split(','))}
    multiple
    className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-sm"
  >
    {['Page', 'Endpoint', 'Finding', 'Action', 'Input', 'Fact', 'AuthFlow', 'RBACRole', 'Attack', 'Hypothesis', 'Reflexion'].map(t => (
      <option key={t} value={t}>{t}</option>
    ))}
  </select>
</div>
```

---

### 6.7 Session Sidebar Search (MEDIUM)

**File:** `src/components/session-sidebar.tsx`

```tsx
const [search, setSearch] = useState('');

const filteredSessions = sessions.filter(s => 
  s.target.toLowerCase().includes(search.toLowerCase())
);

// UI
<input
  placeholder="Search sessions..."
  value={search}
  onChange={e => setSearch(e.target.value)}
  className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-sm"
/>
```

---

### 6.7 Mobile Responsive Layout (LOW)

**Files:** `src/app/home-client.tsx`, `src/app/globals.css`

```css
/* globals.css additions */
@media (max-width: 768px) {
  .graph-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    top: auto;
    height: 50vh;
    max-height: 60vh;
    border-top-left-radius: 1rem;
    border-top-right-radius: 1rem;
  }
  
  .chat-stream {
    height: calc(100vh - 50vh - 8rem);
  }
  
  .session-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 85vw;
    max-width: 320px;
    z-index: 50;
    transform: translateX(-100%);
    transition: transform 0.3s ease;
  }
  
  .session-sidebar.open {
    transform: translateX(0);
  }
}
```

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| No message jumping during streaming | ⬜ |
| Tool calls formatted (not raw JSON) | ⬜ |
| Ctrl+K opens search | ⬜ |
| Progress indicators for long ops | ⬜ |
| Message copy/export works | ⬜ |
| Live answer preview stable | ⬜ |
| Streaming indicator visible | ⬜ |
| Message timestamps visible | ⬜ |
| Tool call duration shown | ⬜ |
| Message copy button works | ⬜ |
| Budget panel in status bar | ⬜ |
| Budget panel dropdown works | ⬜ |
| Graph panel filtering works | ⬜ |
| Session sidebar search works | ⬜ |
| Mobile layout works | ⬜ |
| All 2226 tests pass | ⬜ |
| Clean TypeScript build | ⬜ |
| Clean build (ESM, CJS, DTS) | ⬜ |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/chat-stream.tsx` | Stable keys, search, progress, stable streaming |
| `src/components/tool-call-card.tsx` | Formatted output, copy button |
| `src/components/chat-input.tsx` | (minor) |
| `src/components/MarkdownBlock.tsx` | Verify streaming |
| `src/components/MessageBubble.tsx` (new) | Extract message rendering |
| `src/components/budget-panel.tsx` | NEW - Budget panel |
| `src/components/status-bar.tsx` | Add budget dropdown |
| `src/components/graph-panel.tsx` | Add filtering |
| `src/components/session-sidebar.tsx` | Add search |
| `src/app/globals.css` | Mobile responsive |
| `src/app/home-client.tsx` | Mobile layout |

---

## Test Plan

- [ ] Manual: Send message, verify no jumping during streaming
- [ ] Manual: Tool call shows formatted args/result
- [ ] Manual: Ctrl+K opens search, filters messages
- [ ] Manual: Long operation shows progress
- [ ] Manual: Copy message works
- [ ] Manual: Live answer doesn't flicker
- [ ] Manual: Streaming indicator visible
- [ ] Manual: Timestamps visible
- [ ] Manual: Tool call duration visible
- [ ] Manual: Copy button copies content
- [ ] Manual: Budget panel opens from status bar
- [ ] Manual: Budget warning at 80%
- [ ] Manual: Graph panel filters work
- [ ] Manual: Session sidebar search works
- [ ] Manual: Mobile layout works
- [ ] All 2226 tests pass
- [ ] Clean build (ESM, CJS, DTS)