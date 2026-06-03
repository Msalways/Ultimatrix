// src/primitives/session.ts
//
// Session-management primitive: useSession.
// The Composer calls this to switch the active session (guest/user/admin)
// so subsequent primitives (httpRequest, evaluateRendered) execute as that role.

import type { PrimitiveContext, PrimitiveDefinition, PrimitiveResult } from './types';

export interface SessionSpec {
  role: 'guest' | 'user' | 'admin' | string;
  cookies?: Record<string, string>;
  bearerToken?: string;
}

export const useSession: PrimitiveDefinition<SessionSpec, SessionSpec> = {
  name: 'useSession',
  description: 'Switch the active session to the given role. The new cookies/token replace the ctx.cookies used by all subsequent primitives in this composer run.',
  requiresBrowser: false,
  deterministic: true,
  execute(args, ctx): PrimitiveResult<SessionSpec> {
    const start = Date.now();
    const cookies: Record<string, string> = { ...(args.cookies ?? {}) };
    if (args.bearerToken) {
      cookies['__bearer__'] = args.bearerToken;
    }
    // Mutate context so subsequent primitives see the new cookies
    for (const k of Object.keys(ctx.cookies)) delete ctx.cookies[k];
    Object.assign(ctx.cookies, cookies);
    ctx.sessionRole = args.role;
    return {
      ok: true,
      value: { role: args.role, cookies, bearerToken: args.bearerToken },
      durationMs: Date.now() - start,
    };
  },
};
