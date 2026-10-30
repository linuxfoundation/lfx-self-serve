// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgClaAdminService } from '../services/org-cla-admin.service';
import { OrgClaManagerScopesService } from '../services/org-cla-manager-scopes.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { firstGrant } from './first-grant.helper';
import { assertOrgLensRead, type OrgLensReadQualification } from './org-lens-read-access.helper';

const claManagerScopes = new OrgClaManagerScopesService();
const claAdmins = new OrgClaAdminService();

/**
 * How a caller cleared the CLA gate, when the Org Lens read gate does not admit them: `cla-admin` is
 * the `b2b_org#cla_admin` relation on this organization, `cla-manager-scope` an ACS `cla-manager`
 * scope on its company. Neither is `org-grant`, so no caller sharing a resolved result across
 * requesters serves either one the shared copy.
 */
export type OrgLensClaQualification = OrgLensReadQualification | 'cla-admin' | 'cla-manager-scope';

/**
 * Read gate for the Org Lens EasyCLA routes only. Every other lens route keeps `assertOrgLensRead`:
 * a CLA Manager gains the CLA tab of their own company, never organization-wide read.
 *
 * The Org Lens read gate decides first and its admission is final, so an auditor or writer who is
 * also a CLA Manager keeps everything the grant gives them, and never reaches the authorizer's
 * `cla_admin` or user-service. When it refuses — 403, or 503 because it could not check — the
 * `cla_admin` relation on this organization and the caller's own `cla-manager` scopes are asked
 * together, and either admits as soon as it answers (`firstGrant`), so a stalled upstream does not
 * delay a caller the other already admits. Both name this organization only: holding the role
 * somewhere is not enough.
 *
 * A failed `cla_admin` check answers "not held" (`OrgClaAdminService`), so while the scopes remain a
 * qualification the outcome is theirs. Otherwise neither upstream's failure overrides the other's
 * answer, as in `assertOrgLensRead`: a roster outage does not withhold access ACS confirms, and an
 * ACS outage turns a 403 into a 503 rather than a verified denial. A scopes answer that does not
 * name this organization replays the read gate's own error unchanged.
 */
export async function assertOrgLensClaRead(req: Request, orgUid: string, operation: string): Promise<OrgLensClaQualification> {
  let readGateError: unknown;
  try {
    return await assertOrgLensRead(req, orgUid, operation);
  } catch (error) {
    readGateError = error;
  }

  if (!(readGateError instanceof MicroserviceError) || (readGateError.statusCode !== 403 && readGateError.statusCode !== 503)) {
    throw readGateError;
  }
  if (!getEffectiveUsername(req)) {
    throw readGateError;
  }

  const scopesAnswer: Promise<{ companySfids: ReadonlySet<string> } | { failed: unknown }> = claManagerScopes.getCompanySfids(req).then(
    (companySfids) => ({ companySfids }),
    (failed: unknown) => ({ failed })
  );
  const granted = await firstGrant<OrgLensClaQualification>([
    claAdmins.holds(req, orgUid).then((held) => (held ? 'cla-admin' : null)),
    scopesAnswer.then((scopes) => ('companySfids' in scopes && scopes.companySfids.has(orgUid) ? 'cla-manager-scope' : null)),
  ]);
  if (granted) {
    return granted;
  }

  const scopes = await scopesAnswer;
  if ('failed' in scopes) {
    logger.warning(req, operation, 'CLA manager scopes lookup failed; cannot verify Org Lens CLA access', {
      org_uid: orgUid,
      err: scopes.failed instanceof Error ? scopes.failed.message : String(scopes.failed),
    });
    if (readGateError.statusCode === 503) {
      throw readGateError;
    }
    throw new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'CLA_MANAGER_SCOPES_UNAVAILABLE', {
      operation,
      service: 'org_cla_manager_scopes',
      path: '/me/permissions',
      originalError: scopes.failed instanceof Error ? scopes.failed : undefined,
    });
  }

  throw readGateError;
}
