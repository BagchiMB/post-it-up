import type { AdminSession } from '@postitup/shared';

import { balanceStatus } from '../openrouter.ts';
import { openRouterKey, serverSettings } from '../server-settings.ts';
import { loginEnabled } from './account.ts';
import { accountView } from './api.ts';

/** GET /admin/api/session: the signed-in admin (the route itself 401s without a session). */
export function sessionView(): AdminSession {
  const a = accountView();
  return {
    signedIn: true as const,
    username: a?.username ?? null,
    lastLoginAt: a?.lastLoginAt ?? null,
    lastLoginIp: a?.lastLoginIp ?? null,
    weakPassword: a?.weakPassword ?? false,
    loginEnabled: loginEnabled(),
    /** For the global low/empty balance banner. */
    openrouter: { balance: balanceStatus(openRouterKey(), serverSettings().lowBalanceUsd) },
  };
}
