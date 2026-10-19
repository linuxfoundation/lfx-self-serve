// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgClaManagerScopesService } from '../services/org-cla-manager-scopes.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { assertOrgLensRead, type OrgLensReadQualification } from './org-lens-read-access.helper';

const claManagerScopes = new OrgClaManagerScopesService();

/**
 * How a caller cleared the CLA gate. `cla-manager-scope` is an ACS `cla-manager` scope on this
 * organization's company, held by a caller the Org Lens read gate does not admit. It is never
 * `org-grant`, so no caller sharing a resolved result across requesters serves it the shared copy.
 */
export type OrgLensClaQualification = OrgLensReadQualification | 'cla-manager-scope';

/**
 * Read gate for the Org Lens EasyCLA routes only. Every other lens route keeps `assertOrgLensRead`:
 * a CLA Manager gains the CLA tab of their own company, never organization-wide read.
 *
 * The Org Lens read gate decides first and its admission is final, so a caller it admits never
 * reaches user-service. When it refuses — 403, or 503 because it could not check — the caller's own
 * `cla-manager` scopes are asked, and admit only when they name this organization's SFID: holding
 * the role somewhere is not enough.
 *
 * Neither upstream's failure overrides the other's answer, as in `assertOrgLensRead`: a roster
 * outage does not withhold access ACS confirms, and an ACS outage turns a 403 into a 503 rather than
 * a verified denial. A scopes answer that does not name this organization replays the read gate's
 * own error unchanged.
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

  let companySfids: ReadonlySet<string>;
  try {
    companySfids = await claManagerScopes.getCompanySfids(req);
  } catch (error) {
    logger.warning(req, operation, 'CLA manager scopes lookup failed; cannot verify Org Lens CLA access', {
      org_uid: orgUid,
      err: error instanceof Error ? error.message : String(error),
    });
    if (readGateError.statusCode === 503) {
      throw readGateError;
    }
    throw new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'CLA_MANAGER_SCOPES_UNAVAILABLE', {
      operation,
      service: 'org_cla_manager_scopes',
      path: '/me/permissions',
      originalError: error instanceof Error ? error : undefined,
    });
  }

  if (companySfids.has(orgUid)) {
    return 'cla-manager-scope';
  }
  throw readGateError;
}
