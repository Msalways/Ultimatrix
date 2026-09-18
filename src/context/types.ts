/**
 * Context Compiler types (Phase 3).
 *
 * The Context Compiler produces the smallest useful investigation context
 * for a worker — only what the model needs to know for the current task.
 */

/** Input for context compilation */
export interface CompileContextInput {
  /** Run ID */
  runId: string
  /** Task ID */
  taskId: string
  /** What the worker should investigate */
  objective: string
  /** Skill being used (if any) */
  skillId?: string
  /** Exchange artifact refs directly relevant to this task */
  exchangeRefs?: string[]
  /** Experiment refs to include */
  experimentRefs?: string[]
  /** Candidate finding refs to include */
  candidateRefs?: string[]
  /** Maximum token budget for the compiled context */
  tokenBudget: number
}

/** A single source view in the compiled context */
export interface SourceView {
  /** Reference ID (exchange, graph node, etc.) */
  ref: string
  /** Source type (exchange, fact, experiment, finding, lesson, artifact) */
  type: string
  /** Compact preview of the source content */
  preview: string
  /** Relevance score (0-1, higher = more relevant) */
  relevance: number
}

/** An omitted source (budget exceeded) */
export interface ContextOmission {
  /** Type of omitted source */
  type: string
  /** Number of sources of this type omitted */
  count: number
  /** Why it was omitted */
  reason: string
}

/** Compiled investigation context view */
export interface ResearchContextView {
  /** The task objective */
  objective: string
  /** Compact summary of the context */
  summary: string

  /** References included in context */
  graphRefs: string[]
  opportunityRefs: string[]
  experimentRefs: string[]
  evidenceRefs: string[]
  artifactRefs: string[]
  findingRefs: string[]

  /** Individual source views (sorted by relevance) */
  sourceViews: SourceView[]

  /** What was omitted and why */
  omissions: ContextOmission[]

  /** Estimated token count for this context */
  tokenEstimate: number
}

/** Token estimation per source type */
export const TOKEN_ESTIMATES: Record<string, number> = {
  identity: 100,       // objective, skill, target
  exchange: 80,        // per exchange preview
  fact: 40,            // per graph fact
  experiment: 60,      // per experiment
  finding: 60,         // per finding
  lesson: 50,          // per historical lesson
  artifact: 20,        // per artifact ref
}
