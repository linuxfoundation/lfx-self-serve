// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LF_STAFF_TEAM_ID } from '@lfx-one/shared/constants';
import type { AccessCheckRequest, CdpAudienceAnswer } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { cdpAudienceTeamIds } from '../services/org-role-grants.service';
import { isImpersonating } from '../utils/auth-helper';

const accessCheck = new AccessCheckService();

/**
 * Spec 062 FR-010, FR-011 — is the caller in the CDP company audience? One strict authorizer batch of
 * `team:<id>#member` over `cdpAudienceTeamIds()` (`lf-staff`, plus the global org admins team while
 * `OrgLensCdpGlobalOrgAdmins` is on): in as a member of any of them. Never the fail-soft `isStaff` affordance or
 * `checkLFStaff`. The `lf-staff` answer of the same batch is kept for Meetings and Groups (DR-044).
 *
 * An impersonating session is outside for every CDP request, decided before any check: the token carries the
 * target's identity, and CDP access must not follow a target into a "view as" session (research R2).
 * An authorizer failure is `unverifiable`, never `out`, so the caller sees "could not verify" (FR-013).
 *
 * Shared by the `requireCdpAudience` route gate, the `/availability` answer and the Participating Companies links.
 */
export async function resolveCdpAudience(req: Request): Promise<CdpAudienceAnswer> {
  if (isImpersonating(req)) {
    return { status: 'out', lfStaff: false };
  }

  const teamIds = cdpAudienceTeamIds();
  let membership: Map<string, boolean>;
  try {
    membership = await accessCheck.checkAccessStrict(
      req,
      teamIds.map((id): AccessCheckRequest => ({ resource: 'team', id, access: 'member' }))
    );
  } catch (error) {
    logger.warning(req, 'resolve_cdp_audience', 'CDP audience check failed; caller cannot be verified', { err: error });
    return { status: 'unverifiable', lfStaff: false };
  }

  const lfStaff = membership.get(`${LF_STAFF_TEAM_ID}#member`) === true;
  const inAudience = teamIds.some((id) => membership.get(`${id}#member`) === true);
  return inAudience ? { status: 'in', lfStaff } : { status: 'out', lfStaff: false };
}
