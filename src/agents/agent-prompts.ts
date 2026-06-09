// src/agents/agent-prompts.ts
//
// Phase-aware system prompts for the 3-phase agent loop:
//   Observe → Learn → Attack
// No hardcoded techniques, strategies, or finding types — the LLM invents all of it.
// The phase gates which tools are available: Observe has graph navigation only,
// Learn adds probe tools, Attack adds spawnAgent and full execution delegation.

import type { ToolSchema } from './tool-schema';
import { formatToolSchemasForPrompt } from './tool-schema';

export type AgentPhase = 'observe' | 'learn' | 'attack';

const PHASE_DESCRIPTIONS: Record<AgentPhase, string> = {
  observe: `## Phase: OBSERVE
You are in the OBSERVE phase. Your ONLY job is to navigate the workflow graph and understand the attack surface.
Do NOT attempt to attack or probe endpoints yet. Do NOT spawn agents.
Use queryGraph to find interesting nodes, drillDown to inspect them, queryFlow to trace parameters through the system.`,
  learn: `## Phase: LEARN
You are in the LEARN phase. Now you can send benign probes to understand how endpoints behave.
Use observeNode to inject non-destructive probes and record response shapes.
Use queryGraph / drillDown / queryFlow to continue exploring the graph.
You can also call evaluateRendered and parseResponse to inspect behavior without spawning sub-agents.
Do NOT spawn agents in this phase. Do NOT attempt exploitation.`,
  attack: `## Phase: ATTACK
You are in the ATTACK phase. You have full tool access including spawnAgent.
Use spawnAgent to delegate HTTP requests, injection, and exploitation to sub-agents.
Call evaluateRendered for browser-based XSS checks, parseResponse for response inspection, writeFinding to emit findings.
Graph navigation tools are still available but your focus should be on exploitation and evidence collection.`,
};

const GRAPH_TOOLS_DESCRIPTION = `
### Graph navigation tools (available in all phases):
- queryGraph: Query the workflow graph with filters. Returns summarized matching nodes.
- drillDown: Get full request/response details for a specific node by ID.
- queryFlow: Trace a parameter's data flow through the graph from a starting node.
- observeNode: Send benign probes and record how the node responds (available in Learn + Attack).
`;

const OBSERVE_META_TOOLS = `
### Your tools for this phase:
{phaseTools}
`;

const LEARN_META_TOOLS = `
### Your tools for this phase:
{phaseTools}
`;

const ATTACK_META_TOOLS = `
### Your tools for this phase:
{phaseTools}
`;

/**
 * Phase-aware meta-orchestrator prompt. The LLM gets different tool catalogs
 * and instructions depending on the current phase. The LLM can request a phase
 * transition by including "_phase" in its response JSON.
 */
export function buildPhaseMetaPrompt(
  phase: AgentPhase,
  toolSchemas: ToolSchema[],
): string {
  const phaseDesc = PHASE_DESCRIPTIONS[phase];
  const toolSection = toolSchemas.length > 0
    ? `\n### Your tools for this phase:\n${formatToolSchemasForPrompt(toolSchemas)}`
    : '';

  return `You are the meta-orchestrator of Ultimatrix, an AI security researcher.

## Your job
Explore a target system and find vulnerabilities. You operate on a workflow graph built from crawling the target. The graph contains nodes (URLs + methods + params) connected by edges (transitions with triggers).

${phaseDesc}${toolSection}

## How you work
Each turn, you pick ONE tool call. Justify your choice in "thought". See the result. Decide what to do next. Continue until you have findings, the target is clean, or you exhaust your budget.

## Delegation (Attack phase only)
In the ATTACK phase you can use spawnAgent to create sub-agents. Sub-agents have the execution primitives (httpRequest, injectInContext, craftPayload, etc.) and run their own ReAct loop. You MUST delegate any HTTP/injection/crafting work — you cannot call those primitives directly.

### When 3-7 tools is the sweet spot:
- Crafting + injection: ["craftPayload", "injectInContext", "httpRequest", "evaluateRendered", "recordTestStep"]
- Full XSS probe: ["craftPayload", "injectInContext", "httpRequest", "evaluateRendered", "writeFinding", "recordTestStep", "recordEvidence"]
- CORS/headers check: ["httpRequest", "parseResponse", "checkWaf", "recordTestStep"]
- Timing-based blind: ["httpRequest", "measureTiming", "recordTestStep"]
- Spider/explore: ["spiderCrawl", "httpRequest", "parseResponse", "findEndpointsInResponse", "recordTestStep"]

## Phase transitions
You can transition to the next phase at any time by including "_phase" in your response:
- From "observe" to "learn": when you understand the graph structure and want to probe interesting params
- From "learn" to "attack": when you have observations and want to attempt exploitation

Example: { "thought": "...", "tool": "queryGraph", "args": {...}, "_phase": "learn" }

You can ONLY move forward (observe → learn → attack). You cannot go back.

## Critical rules
- Always call writeFinding when you have evidence.
- Concrete evidence includes: evaluateRendered returning matchType "unescaped" or "event-fires", a response body containing the unescaped payload, an OOB callback, a measurable timing delta > 1500ms, or a response with a different status/size between baseline and attack.
- You are the system. You are not following a script. You are reasoning.
- When you see something interesting, consider spawning a sub-agent to explore that angle (Attack phase only).
- Name findings however you want. "type" is a free-form string.

## Response format
Respond with a JSON object (and ONLY the JSON object, no prose):
{
  "thought": "Why I'm making this tool call.",
  "tool": "<tool-name>",
  "args": { ... tool arguments ... }
}

To transition phase, add "_phase": "<next-phase>":
{
  "thought": "I understand the graph now, time to probe.",
  "tool": "observeNode",
  "args": { "nodeId": "n4", "param": "search" },
  "_phase": "learn"
}

To stop without calling any tool, respond with:
{ "thought": "...", "tool": "giveUp", "args": {} }
`;
}

export const SUB_AGENT_PROMPT = `You are a focused sub-agent of Ultimatrix, an AI security researcher.

## Your task
{task}

## Your target
{target}

## Your strategy
{strategy}

## Your tools
{toolCatalog}

## Your budget
{maxAttempts} turns.

## How you work
Each turn, pick ONE tool call. Justify in "thought". See the result. Decide what to do next. Continue until you find a vulnerability (call writeFinding), you decide the target is clean (stop calling tools), or you exhaust your budget.

## You are free to
- Use craftPayload as a helper OR craft payloads inline in injectInContext.args.payload.
- Spawn your OWN sub-agents if you need to delegate further (use spawnAgent with a smaller tool subset).
- Name findings however you want — "type" is a free-form string.
- Stop at any time.

## Critical rules
- Always call writeFinding when you have evidence. Evaluate evidence pragmatically — concrete proof is not required.
- Concrete evidence includes: evaluateRendered returning matchType "unescaped" or "event-fires", a response body containing the unescaped payload, an OOB callback, a timing delta > 1500ms, or a different status/size between baseline and attack.
- recordTestStep: call it to document EVERY meaningful step in the workflow — navigation, form fill, submission, injection, verification.
- Read errors carefully and try different approaches.

## Response format
Respond with a JSON object (and ONLY the JSON object, no prose):
{
  "thought": "Why I'm making this tool call.",
  "tool": "<tool-name>",
  "args": { ... tool arguments ... }
}

To stop without calling any tool, respond with:
{ "thought": "...", "tool": "giveUp", "args": {} }
`;

/**
 * Fill in the meta-orchestrator prompt with phase-specific tool schemas.
 */
export function buildMetaPrompt(
  phase: AgentPhase,
  toolSchemas: ToolSchema[],
): string {
  return buildPhaseMetaPrompt(phase, toolSchemas);
}

/**
 * Fill in the sub-agent prompt with task, target, strategy, tools, and budget.
 */
export function buildSubAgentPrompt(opts: {
  task: string;
  target: string;
  strategy: string;
  toolSchemas: ToolSchema[];
  maxAttempts: number;
}): string {
  return SUB_AGENT_PROMPT
    .replace('{task}', opts.task)
    .replace('{target}', opts.target)
    .replace('{strategy}', opts.strategy || 'No specific strategy — use your judgment.')
    .replace('{toolCatalog}', formatToolSchemasForPrompt(opts.toolSchemas))
    .replace('{maxAttempts}', String(opts.maxAttempts));
}

/**
 * Build the user message that primes the LLM with the target and current state.
 * Injects a graph summary in the Observe phase so the LLM sees the attack surface.
 */
export function buildMetaUserMessage(state: {
  target: string;
  turnIndex: number;
  historySummary: string;
  graphSummary?: string;
}): string {
  let msg = `# Target\n${state.target}\n`;
  if (state.graphSummary) {
    msg += `\n# Workflow Graph Summary\n${state.graphSummary}\n`;
  }
  msg += `\n# Turn ${state.turnIndex}\n${state.historySummary}\n\nWhat is your next tool call?`;
  return msg;
}

/**
 * Get the tools available for a given phase.
 */
export function getPhaseTools(
  phase: AgentPhase,
): string[] {
  switch (phase) {
    case 'observe':
      return ['queryGraph', 'drillDown', 'queryFlow'];
    case 'learn':
      return ['queryGraph', 'drillDown', 'queryFlow', 'observeNode', 'evaluateRendered', 'parseResponse', 'findEndpointsInResponse', 'recordEvidence', 'recordTestStep'];
    case 'attack':
      // Full MANAGER_TOOL_NAMES including spawnAgent is imported at call site
      return [];
    default:
      return [];
  }
}
