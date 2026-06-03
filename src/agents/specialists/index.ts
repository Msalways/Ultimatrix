/**
 * src/agents/specialists/index.ts
 *
 * Registry of specialist sub-agents. Exports the per-scan selector
 * `selectSpecialistsForScan()` which uses the relevance heuristic
 * on each specialist to pick the minimal set for the current target.
 */

import type { SubAgent } from 'deepagents';
import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory, SpecialistToolkit } from './types';
import { xssSpecialist } from './xss';
import { idorSpecialist } from './idor';
import { jwtSpecialist } from './jwt';
import { graphqlSpecialist } from './graphql';
import { wafMutatorSpecialist } from './waf-mutator';
import { triageReviewerSpecialist } from './triage-reviewer';
import { oauthSpecialist } from './oauth';
import { cloudSpecialist } from './cloud';
import { raceSpecialist } from './race';

export const ALL_SPECIALISTS: SpecialistFactory[] = [
  xssSpecialist,
  idorSpecialist,
  jwtSpecialist,
  graphqlSpecialist,
  wafMutatorSpecialist,
  oauthSpecialist,
  cloudSpecialist,
  raceSpecialist,
  triageReviewerSpecialist,
];

export interface SelectionResult {
  specialists: SubAgent[];
  selectedNames: string[];
  skipped: Array<{ name: string; reason: string }>;
}

export async function selectSpecialistsForScan(
  appModel: AppModel,
  toolkit: SpecialistToolkit,
  options: { includeTriage?: boolean; alwaysInclude?: string[] } = {},
): Promise<SelectionResult> {
  const alwaysInclude = new Set(options.alwaysInclude || []);
  const includeTriage = options.includeTriage ?? true;
  const selected: SubAgent[] = [];
  const selectedNames: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const factory of ALL_SPECIALISTS) {
    const isTriage = factory.name === 'triage-reviewer-specialist';
    if (isTriage && !includeTriage) {
      skipped.push({ name: factory.name, reason: 'triage excluded by options' });
      continue;
    }
    if (alwaysInclude.has(factory.name)) {
      selected.push(factory.build(toolkit));
      selectedNames.push(factory.name);
      continue;
    }
    try {
      const include = await Promise.resolve(factory.shouldInclude(appModel));
      if (include) {
        selected.push(factory.build(toolkit));
        selectedNames.push(factory.name);
      } else {
        skipped.push({ name: factory.name, reason: 'not relevant to this scan' });
      }
    } catch (e) {
      skipped.push({
        name: factory.name,
        reason: `shouldInclude threw: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return { specialists: selected, selectedNames, skipped };
}

export function listAllSpecialistNames(): string[] {
  return ALL_SPECIALISTS.map((s) => s.name);
}

export {
  xssSpecialist,
  idorSpecialist,
  jwtSpecialist,
  graphqlSpecialist,
  wafMutatorSpecialist,
  triageReviewerSpecialist,
  oauthSpecialist,
  cloudSpecialist,
  raceSpecialist,
};
export type { SpecialistFactory, SpecialistToolkit };
