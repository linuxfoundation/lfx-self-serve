// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { GW_HOST_SESSION_APP_SESSION_COOKIE, GW_HOST_SESSION_APP_SESSION_ID_PATTERN } from '@lfx-one/shared/constants';

/**
 * Reads the LFX session id from a raw `Cookie` header. With the session store on, the `appSession`
 * cookie is the bare, unsigned session id (`server.ts` `genid`, no `signSessionStoreCookie`), so its
 * value is the id itself. Returns null when the cookie is absent or is not that shape, e.g. the
 * encrypted JWE that cookie mode writes, which has no stable id.
 *
 * Takes the header rather than the request so LFX's `/logout` hook, which runs before
 * express-openid-connect has loaded the session, can use it too. The first `appSession` wins, as in the `cookie` package express-openid-connect uses.
 */
export function readAppSessionId(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const pair of cookieHeader.split(';')) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1 || pair.slice(0, eqIndex).trim() !== GW_HOST_SESSION_APP_SESSION_COOKIE) {
      continue;
    }
    const value = pair.slice(eqIndex + 1).trim();
    return GW_HOST_SESSION_APP_SESSION_ID_PATTERN.test(value) ? value : null;
  }
  return null;
}
