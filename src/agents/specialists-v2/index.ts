// src/agents/specialists-v2/index.ts
//
// All 9 specialists. Each factory builds an agent descriptor. The
// orchestrator picks which to spawn based on shouldInclude().

export * from './types';
export * from './jwt';
export * from './oauth';
export * from './race';
export * from './graphql';
export * from './idor';
export * from './cloud';
export * from './waf-mutator';
export * from './xss';
export * from './second-order';

import type { SpecialistFactory } from './types';
import { jwtSpecialist } from './jwt';
import { oauthSpecialist } from './oauth';
import { raceSpecialist } from './race';
import { graphqlSpecialist } from './graphql';
import { idorSpecialist } from './idor';
import { cloudSpecialist } from './cloud';
import { wafMutatorSpecialist } from './waf-mutator';
import { xssSpecialist } from './xss';
import { secondOrderSpecialist } from './second-order';

export const ALL_SPECIALISTS_V2: readonly SpecialistFactory[] = [
  jwtSpecialist,
  oauthSpecialist,
  raceSpecialist,
  graphqlSpecialist,
  idorSpecialist,
  cloudSpecialist,
  wafMutatorSpecialist,
  xssSpecialist,
  secondOrderSpecialist,
] as const;

/** Pick the specialists that apply to this app model. */
export function selectSpecialists(appModel: import('../../core/app-model').AppModel): SpecialistFactory[] {
  return ALL_SPECIALISTS_V2.filter((s) => {
    try { return s.shouldInclude(appModel); } catch { return false; }
  });
}
