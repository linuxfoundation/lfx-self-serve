// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IntercomBootOptions, User } from '@lfx-one/shared/interfaces';

/**
 * Identified Intercom boot options for a signed-in user, or null when the JWT / user id is missing.
 * Shared by AppComponent's startup boot and OpenIntercomDirective's on-demand boot so a skipped
 * startup (invite landing, impersonation) can still open support as the signed-in user (GH-2290).
 */
export function identifiedIntercomBootOptions(user: User, appId: string): IntercomBootOptions | null {
  const intercomJwt = user['http://lfx.dev/claims/intercom'];
  const userId = user['https://sso.linuxfoundation.org/claims/username'] || user.sub;

  if (!intercomJwt || !userId) {
    return null;
  }

  return {
    app_id: appId,
    intercom_user_jwt: intercomJwt,
    user_id: userId,
    name: user.name,
    email: user.email,
  };
}
