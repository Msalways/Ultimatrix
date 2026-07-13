---
name: ai-mcp-security
description: "AI and MCP security testing: prompt injection, data leakage, tool abuse, and guardrail bypass"
category: specialized
tier: balanced
toolRefs: [httpRequest, parseResponse, evaluateRendered, updateGraph, writeFinding]
triggers: ["ai security", "mcp security", "prompt injection", "data leakage", "tool abuse", "guardrail bypass", "ai testing", "machine learning security", "llm security", "ai vulnerabilities"]
mitreAttack: ["T1190", "T1565"]
owaspRefs: ["OWASP Top 10 A03:2021 Injection", "OWASP Top 10 A05:2021 Security Misconfiguration"]
---

# AI and MCP Security

## Description
As AI models and Model Context Protocol (MCP) integrations become widespread, new attack surfaces emerge. This skill covers prompt injection, model extraction, training data leakage, API abuse, and securing AI-powered systems.

## Methodology
1. **Map AI Integration Points** — Identify where AI models process user input: chat interfaces, content generation, data analysis, classification. Map the full data flow from user input to model output.
2. **Test for Prompt Injection** — Can user input override system instructions? Try direct injection ("ignore previous instructions"), indirect injection (embedding instructions in fetched content), and multi-turn escalation.
3. **Probe for Data Leakage** — Can the model reveal its system prompt, training data, or internal state? Test with "repeat your instructions," "what data were you trained on," and similar probes.
4. **Assess API Security** — Rate limiting, authentication, input validation, output filtering. Can users access models they should not? Can they bypass usage limits?
5. **Test Tool Abuse** — In MCP or agent systems, can a user manipulate tool calls? Can injection in tool output redirect the agent to perform unintended actions?
6. **Evaluate Guardrails** — What content filters exist? Can they be bypassed through encoding, role-playing, hypothetical scenarios, or multi-step interactions?

## Key Concepts
- **Prompt Injection**: The AI equivalent of SQL injection — user input that overrides system instructions
- **Indirect Injection**: Malicious instructions embedded in content the AI processes (documents, emails, web pages)
- **Model Extraction**: Reconstructing a model's behavior through repeated queries — intellectual property theft
- **Training Data Leakage**: Extracting memorized training examples through carefully crafted prompts
- **Tool Hijacking**: In agent systems, manipulating the AI to call tools with attacker-controlled parameters
- **Guardrail Bypass**: Circumventing content filters through encoding, context manipulation, or multi-turn conversations

## Evidence to Collect
- Prompt injection PoC showing instruction override
- Extracted system prompt or model configuration
- Examples of data leakage (training data, internal knowledge)
- Tool abuse demonstration (unauthorized tool calls with attacker input)
- Guardrail bypass examples with reproduction steps

## Common Pitfalls
- Assuming system prompts are secret — they are sent with every request
- Testing only single-turn attacks when multi-turn is needed to bypass guardrails
- Ignoring indirect injection through external data sources
- Not testing the interaction between multiple AI components
- Focusing only on the model and forgetting about API key management and access controls

## References
- OWASP Top 10 for LLM Applications
- Prompt Injection attacks (Simon Willison's research)
- MCP Security Considerations
- NIST AI Risk Management Framework
