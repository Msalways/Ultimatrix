/**
 * src/agents/specialists/index.ts
 *
 * Legacy specialist registry — kept for backward compatibility. The v1
 * hunt pipeline uses the dynamic Composer (src/agents/composer.ts) and
 * the specialist composers (src/agents/specialists-composers/) instead.
 * New code should import from those modules.
 */

import type { SubAgent } from 'deepagents';
import type { AppModel } from '../../core/app-model';
import type { SpecialistFactory, SpecialistToolkit } from './types';
import { xssSpecialist } from './xss';
import { idorSpecialist } from './idor';
import { jwtSpecialist } from './jwt';
import { graphqlSpecialist } from './graphql';
import { wafMutatorSpecialist } from './waf-mutator';
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
];

export interface SelectionResult {
  specialists: SubAgent[];
  selectedNames: string[];
  skipped: Array<{ name: string; reason: string }>;
}

export async function selectSpecialistsForScan(
  appModel: AppModel,
  toolkit: SpecialistToolkit,
  options: { alwaysInclude?: string[] } = {},
): Promise<SelectionResult> {
  const alwaysInclude = new Set(options.alwaysInclude || []);
  const selected: SubAgent[] = [];
  const selectedNames: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const factory of ALL_SPECIALISTS) {
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
  oauthSpecialist,
  cloudSpecialist,
  raceSpecialist,
};
export type { SpecialistFactory, SpecialistToolkit };
