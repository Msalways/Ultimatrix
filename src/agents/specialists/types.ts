/**
 * src/agents/specialists/types.ts
 *
 * Common types for specialist sub-agents.
 */

import type { SubAgent } from 'deepagents';
import type { AppModel } from '../../core/app-model';
import type { SessionPool } from '../../core/session-pool';

export interface SpecialistFactory {
  name: string;
  description: string;
  build: (tools: SpecialistToolkit) => SubAgent;
  shouldInclude: (appModel: AppModel) => boolean | Promise<boolean>;
}

export interface PoolTools {
  listSessions: any;
  switchSession: any;
  loginSession: any;
  diffSessions: any;
  screenshotSession: any;
  getPageText: any;
}

export interface SpecialistToolkit {
  httpRequest: any;
  scratchpadWrite: any;
  scratchpadRead: any;
  conclude: any;
  oastCheck?: any;
  poolTools?: PoolTools;
  sessionPool?: SessionPool;
  // extension points for new specialist tool sets
  oauthProbes?: Record<string, any>;
  cloudProbes?: Record<string, any>;
  raceProbes?: Record<string, any>;
}
