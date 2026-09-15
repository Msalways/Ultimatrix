# Phase 2: Chat Stream UX Overhaul - Specification

## Overview
Fix the core message/response experience in Web UI. The current chat stream has message jumping, raw JSON tool output, no search, and poor streaming UX.

## Tasks

### 2.1 Fix Message Jumping During Streaming (CRITICAL)

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
```

**Implementation:**
```typescript
// In handleSend:
const messageId = nextId();
addMessage({ id: messageId, role: 'assistant', content: '', timestamp: Date.now() });

// During streaming - update same message:
updateMessage(messageId, { content: visibleAnswer });

// On done:
updateMessage(messageId, { content: finalContent, streaming: false });
```

---

### 2.2 Format Tool Calls (Not Raw JSON) - CRITICAL

**File:** `src/components/tool-call-card.tsx`

**Current:** Shows raw JSON in expanded view

**Target:**
- Syntax-highlighted JSON
- Collapsible sections
- Copy button
- Arguments formatted as key-value pairs
- Result formatted with syntax highlighting

**Implementation:**
```tsx
// Use a syntax highlighter component or simple formatter
const formatJson = (obj: unknown) => {
  return JSON.stringify(obj, null, 2);
};

// Add copy button
<button onClick={() => navigator.clipboard.writeText(JSON.stringify(result, null, 2))}>
  <Copy size={12} />
</button>

// Collapsible sections for large results
<details>
  <summary>Result ({result.length} chars)</summary>
  <pre>{formatJson(result)}</pre>
</details>
```

---

### 2.3 Message Search (Ctrl+K) - HIGH

**File:** `src/components/chat-stream.tsx`

**Implementation:**
```tsx
const [searchQuery, setSearchQuery] = useState('');
const [showSearch, setShowSearch] = useState(false);

const filteredMessages = useMemo(() => 
  messages.filter(m => 
    m.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.type?.toLowerCase().includes(searchQuery.toLowerCase())
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
  <div className="fixed top-4 right-4 z-50">
    <input
      type="text"
      placeholder="Search messages... (Ctrl+K)"
      value={searchQuery}
      onChange={e => setSearchQuery(e.target.value)}
      className="px-3 py-2 rounded-md border border-zinc-700 bg-zinc-900 text-white"
      autoFocus
    />
  </div>
)}
```

---

### 2.4 Progress Indicators for Long Operations

**File:** `src/components/chat-stream.tsx`

**Current:** Silent during long operations

**Target:**
- Show spinner with elapsed time
- Show current operation label
- Show progress if available

```tsx
// Add to stream-status message
{isStreaming && (
  <div className="flex items-center gap-2 text-xs text-zinc-500">
    <Loader2 size={12} className="animate-spin" />
    <span>{currentOperation}</span>
    <span className="text-zinc-500">{elapsed}s</span>
  </div>
)
```

---

### 2.5 Message Copy/Export

**File:** `src/components/chat-stream.tsx`

**Add to each message:**
```tsx
<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
  <button onClick={() => navigator.clipboard.writeText(message.content)}>
    <Copy size={12} />
  </button>
  <button onClick={() => exportMessage(message)}>
    <Download size={12} />
  </button>
</div>
```

---

### 2.6 Fix Live Answer Preview Flickering

**Current Problem:** Live answer preview creates separate message, then removed, final answer added - causes jump

**Fix:**
```typescript
// Single message ID for entire answer lifecycle
const answerMessageId = nextId();

// During streaming - update same message
addMessage({ id: answerId, role: 'assistant', content: '', streaming: true });
// Update in place
updateMessage(answerId, { content: visibleAnswer, streaming: true });

// On done - finalize same message
updateMessage(answerId, { content: finalContent, streaming: false });
```

---

### 2.6 Streaming Status Indicators

Add to `MessageBubble`:
```tsx
{isStreaming && (
  <span className="flex items-center gap-1 text-xs text-zinc-500">
    <Loader2 size={10} className="animate-spin" />
    <span>Streaming...</span>
  </span>
)}
```

---

### 2.7 Add Message Timestamps

```tsx
// In MessageBubble
<div className="text-[10px] text-zinc-500 ml-2">
  {new Date(message.timestamp).toLocaleTimeString()}
</div>
```

---

### 2.7 Tool Call Duration Display

**Already in tool-call-card.tsx** - verify it shows correctly.

---

### 2.8 Message Copy Button

```tsx
<button 
  onClick={() => navigator.clipboard.writeText(message.content)}
  className="opacity-0 group-hover:opacity-100"
>
  <Copy size={12} />
</button>
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

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/chat-stream.tsx` | Stable keys, search, progress, copy |
| `src/components/tool-call-card.tsx` | Formatted output, copy button |
| `src/components/chat-input.tsx` | (minor) |
| `src/components/MarkdownBlock.tsx` | (verify streaming) |
| `src/components/MessageBubble.tsx` (new) | Extract message rendering |

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
- [ ] Manual: Tool duration visible
- [ ] Manual: Copy button copies content
- [ ] All 2226 tests pass
- [ ] Clean TypeScript build
- [ ] Clean build (ESM, CJS, DTS)