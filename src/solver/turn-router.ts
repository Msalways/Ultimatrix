import type { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const TurnDecisionSchema = z.object({
  action: z.enum(["respond", "inspect_context", "discover_capability", "use_capability", "ask_user"]),
  response: z.string().optional(),
  objective: z.string().optional(),
  capability: z.string().optional(),
  reason: z.string().optional(),
});

type TurnDecision = z.infer<typeof TurnDecisionSchema>;

export type TurnRoute =
  | { kind: "direct"; response: string; reasoning?: string }
  | { kind: "capability"; reasoning?: string };

export async function decideTurnRoute(agent: Agent, input: {
  goal: string;
  runtimeEnvelope: string;
  interactionMode?: "ask" | "run";
  memory?: { thread: string; resource: string };
  signal: AbortSignal;
}): Promise<TurnRoute> {
  const setTools = (agent as any).setTurnToolsOverride as ((tools?: Record<string, any>) => void) | undefined;
  if (!setTools) return { kind: "capability" };

  let decision: TurnDecision | undefined;
  const decideTurn = createTool({
    id: "decideTurn",
    description: "Route this turn to either a direct assistant response or capability-backed work.",
    inputSchema: TurnDecisionSchema,
    execute: async (value) => {
      decision = value;
      return { ok: true };
    },
  });

  try {
    setTools({ decideTurn });
    const stream = await agent.stream(buildPrompt(input), {
      maxSteps: 1,
      toolChoice: "required",
      ...(input.memory ? { memory: input.memory } : {}),
      abortSignal: input.signal,
    });

    for await (const _chunk of stream.fullStream) {
      if (input.signal.aborted) throw new Error("Solver interrupted");
    }

    const [text, reasoning] = await Promise.all([
      stream.text as Promise<string | undefined>,
      stream.reasoningText as Promise<string | undefined>,
    ]);

    const finalDecision = decision ?? (text?.trim() ? { action: "respond" as const, response: text } : undefined);
    if (finalDecision?.action === "respond" || finalDecision?.action === "ask_user") {
      return { kind: "direct", response: finalDecision.response ?? finalDecision.reason ?? "", reasoning };
    }
    return { kind: "capability", reasoning };
  } finally {
    setTools(undefined);
  }
}

function buildPrompt(input: {
  goal: string;
  runtimeEnvelope: string;
  interactionMode?: "ask" | "run";
}): string {
  return `${input.goal}

Decide this turn with the decideTurn tool.
- respond: answer from the prompt, conversation, graph summary, or session context.
- inspect_context: stored graph/session memory must be read before answering.
- discover_capability: connector/tool metadata must be inspected.
- use_capability: live browser/crawl/tool execution is needed.
- ask_user: missing user input blocks safe progress.
- Put the user-facing answer in response for respond or ask_user.

Requested mode hint: ${input.interactionMode ?? "auto"}.
${input.runtimeEnvelope}`;
}
