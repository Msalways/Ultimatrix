# Ultimatrix Configuration Examples

## Lightweight Provider Setup

### Groq (Recommended for Speed)
```yaml
# ultimatrix.yaml
model: groq/llama-3.1-8b-instruct
target: https://example.com
depth: 2
headless: true
timeout: 60000

modelTiers:
  fast: groq/llama-3.1-8b-instruct
  balanced: groq/llama-3.1-70b-instruct
  powerful: groq/llama-3.1-70b-instruct
```

```bash
# Set API key
export GROQ_API_KEY="your-api-key-here"
```

### Mistral AI (Balanced Performance)
```yaml
# ultimatrix.yaml
model: mistral/mixtral-8x7b-instruct-v0.1
target: https://example.com
depth: 3
headless: true
timeout: 90000

modelTiers:
  fast: mistral/mixtral-8x7b-instruct-v0.1
  balanced: mistral/mistral-large-2402-v1:0
  powerful: mistral/mistral-large-2402-v1:0
```

```bash
# Set API key
export MISTRAL_API_KEY="your-api-key-here"
```

### DeepSeek (Cost-Effective)
```yaml
# ultimatrix.yaml
model: deepseek/deepseek-chat
target: https://example.com
depth: 2
headless: true
timeout: 60000

modelTiers:
  fast: deepseek/deepseek-chat
  balanced: deepseek/deepseek-chat
  powerful: deepseek/deepseek-chat
```

```bash
# Set API key
export DEEPSEEK_API_KEY="your-api-key-here"
```

### Local Ollama (Private/Offline)
```yaml
# ultimatrix.yaml
model: ollama/llama3.1:8b
target: https://example.com
depth: 2
headless: true
timeout: 120000

modelTiers:
  fast: ollama/llama3.1:8b
  balanced: ollama/qwen2.5:7b
  powerful: ollama/qwen2.5:32b
```

```bash
# Install Ollama first
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
ollama serve

# Pull models
ollama pull llama3.1:8b
ollama pull qwen2.5:7b
ollama pull qwen2.5:32b
```

## Provider Comparison

| Provider | Speed | Cost | Privacy | Best For |
|----------|-------|------|---------|----------|
| **Groq** | ⚡⚡⚡⚡⚡ | $ | 🌐 | Real-time scanning |
| **Mistral** | ⚡⚡⚡ | $$ | 🌐 | Balanced performance |
| **DeepSeek** | ⚡⚡ | $ | 🌐 | Cost-effective scanning |
| **Ollama** | ⚡⚡ | FREE | 🔒 | Private/offline testing |

## Quick Start Commands

### Fast Scanning with Groq
```bash
export GROQ_API_KEY="your-key"
ultimatrix scan -t https://example.com --model groq/llama-3.1-8b-instruct
```

### Cost-Effective with DeepSeek
```bash
export DEEPSEEK_API_KEY="your-key"
ultimatrix scan -t https://example.com --model deepseek/deepseek-chat
```

### Private Testing with Ollama
```bash
# Make sure Ollama is running
ollama serve

ultimatrix scan -t https://example.com --model ollama/llama3.1:8b
```

## Performance Tips

1. **Use Fast Models for Initial Scans**: Start with 8B models for quick discovery
2. **Use Larger Models for Deep Analysis**: Use 70B+ models for complex vulnerabilities
3. **Tiered Approach**: Configure different models for different stages
4. **Local Testing**: Use Ollama for sensitive targets or offline work

## Solver Engine Config

The solver engine runs a single agent stream per turn. Configure budgets per your provider's limits:

```yaml
engine: solver
solver:
  maxToolCalls: 50       # Max tool-call rounds per turn (Mastra maxSteps)
  maxTokens: 100000      # Max tokens per turn (adjust to provider context window)
  maxDurationMs: 300000  # Max wall-clock time per turn (5 min default)
  maxParallel: 1         # Parallel solver brains (future use)
antiLoop:
  staleThreshold: 3      # Reflexion triggers after N stale cycles
```

**Provider-specific tuning:**

| Provider | Model | maxTokens | maxToolCalls | Notes |
|----------|-------|-----------|--------------|-------|
| Groq | llama3-8b-8192 | 8000 | 20 | Small context window |
| Groq | llama-3.1-8b-instant | 128000 | 50 | Large context |
| OpenAI | gpt-4o-mini | 128000 | 50 | Good all-round |
| Anthropic | claude-3-5-sonnet | 200000 | 50 | Largest context |
| Google | gemini-2.0-flash | 1048576 | 100 | Huge context |
| NVIDIA | nemotron-3-ultra | 131072 | 50 | Large context |

## Model Capabilities + Context Overflow Fallback

`modelCapabilities` is the single source of truth for model limits. The system uses it for:
- Pre-send context validation
- Context overflow recovery (auto-compact + retry)
- Model selection scoring

```yaml
modelCapabilities:
  groq/llama3-8b-8192:
    contextWindow: 8192
    maxOutputTokens: 2048
    reservedMargin: 512        # optional, default 1024 — safety buffer
    strengths: [speed]
    supportsStreaming: true
    supportsStructuredOutput: false
  openai/gpt-4o:
    contextWindow: 128000
    maxOutputTokens: 16384
    strengths: [reasoning, coding]
    supportsStreaming: true
    supportsStructuredOutput: true
  anthropic/claude-3-5-sonnet:
    contextWindow: 200000
    maxOutputTokens: 8192
    strengths: [reasoning, analysis]
    supportsStreaming: true
    supportsStructuredOutput: true
```

**`reservedMargin`**: Safety buffer subtracted from `contextWindow` when checking if prompts fit. Default 1024. Increase for models with tight token counting (e.g., `reservedMargin: 2048` for small-context models).

**Unknown models**: When a model is not in `modelCapabilities`, the system returns `null` for context window lookups. The reactive overflow handler catches HTTP 400 errors and attempts compaction anyway — no hardcoded fallback map.