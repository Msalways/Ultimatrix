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