// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { IntercomBootOptions, User } from '@lfx-one/shared/interfaces';

/**
 * Identified Intercom boot options for a signed-in user, or null when the JWT / user id is missing.
 * Only AppComponent calls this — it stages the result on IntercomService so the invite landing,
 * which skips the startup boot, can still open support as the signed-in user (GH-2290).
 *
 * Never call it with an impersonated `user`: the impersonation override rewrites the identity
 * claims for the target but leaves `http://lfx.dev/claims/intercom` as the operator's own JWT, so
 * the result would pair the operator's JWT with the target's PII.
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
