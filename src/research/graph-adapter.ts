import { NodeType, type CandidateFindingNode, type EntityNode, type ExperimentNode, type HypothesisNode, type WorkflowNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { FindingCandidate, ResearchEntity, ResearchExperiment, ResearchHypothesis, ResearchSnapshot, ResearchWorkflow } from './types'

export function persistWorkflows(store: GraphStore, workflows: ResearchWorkflow[]): WorkflowNode[] {
  return workflows.map(({ id, ...properties }) => store.upsertNode({
    id,
    type: NodeType.WORKFLOW,
    label: `Workflow: ${properties.name}`,
    properties,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as WorkflowNode) as WorkflowNode)
}

export function persistEntities(store: GraphStore, entities: ResearchEntity[]): EntityNode[] {
  return entities.map(({ id, ...properties }) => store.upsertNode({
    id,
    type: NodeType.ENTITY,
    label: `Entity: ${properties.name}`,
    properties,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as EntityNode) as EntityNode)
}

export function persistHypotheses(store: GraphStore, hypotheses: ResearchHypothesis[]): HypothesisNode[] {
  return hypotheses.map(({ id, ...properties }) => store.upsertNode({
    id,
    type: NodeType.HYPOTHESIS,
    label: `Hypothesis: ${properties.title}`,
    properties,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as HypothesisNode) as HypothesisNode)
}

export function persistExperiments(store: GraphStore, experiments: ResearchExperiment[]): ExperimentNode[] {
  return experiments.map(({ id, ...properties }) => store.upsertNode({
    id,
    type: NodeType.EXPERIMENT,
    label: `Experiment: ${properties.title}`,
    properties,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as ExperimentNode) as ExperimentNode)
}

export function getResearchSnapshot(store: GraphStore): ResearchSnapshot {
  return {
    workflows: (store.queryNodes(NodeType.WORKFLOW) as WorkflowNode[]).map(n => ({ id: n.id, ...n.properties })),
    entities: (store.queryNodes(NodeType.ENTITY) as EntityNode[]).map(n => ({ id: n.id, ...n.properties })),
    hypotheses: (store.queryNodes(NodeType.HYPOTHESIS) as HypothesisNode[]).map(n => ({ id: n.id, ...n.properties } as any as ResearchHypothesis)),
    experiments: (store.queryNodes(NodeType.EXPERIMENT) as ExperimentNode[]).map(n => ({ id: n.id, ...n.properties } as any as ResearchExperiment)),
    candidates: (store.queryNodes(NodeType.CANDIDATE_FINDING) as CandidateFindingNode[]).map(n => ({ id: n.id, ...n.properties } as FindingCandidate)),
  }
}
