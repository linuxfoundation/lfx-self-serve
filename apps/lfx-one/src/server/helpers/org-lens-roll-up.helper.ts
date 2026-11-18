// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE, ORG_LENS_ROLLUP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import type { AccessAwareOrgsResult, OrgLensRollUpScope, OrgRollUpSetOrg, OrgStaffRollUpFamily } from '@lfx-one/shared/interfaces';
import { orgRollUpRootUid } from '@lfx-one/shared/utils/org-lens-url.utils';
import type { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { LaunchDarklyServerService } from '../services/launchdarkly-server.service';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { assertOrgLensRead } from './org-lens-read-access.helper';

const roleGrants = new OrgRoleGrantsService();

const scopeByRequest = new WeakMap<Request, Map<string, Promise<OrgLensRollUpScope>>>();

/**
 * Read gate and scope for an Org Lens family roll-up key (`family-<top account id>`).
 *
 * Each candidate organization must pass `assertOrgLensRead`. `members` is the only set of
 * organizations a roll-up read may serve; one the caller is refused on is left out.
 * `complete: false` means the family may be missing organizations the page should say it cannot
 * show.
 *
 * Throws 400 for a malformed key, 403 when the caller may not read the family, and
 * a retriable 503 when access cannot be verified (lookup failed, a member's check could not be
 * answered, or the family is absent from a partial set).
 *
 * Memoized per request and key: the route middleware and a handler that also resolves share one
 * roster lookup and one set of member checks.
 */
export async function resolveOrgLensRollUp(req: Request, rollUpKey: string, operation: string): Promise<OrgLensRollUpScope> {
  let byKey = scopeByRequest.get(req);
  if (!byKey) {
    byKey = new Map();
    scopeByRequest.set(req, byKey);
  }
  let scope = byKey.get(rollUpKey);
  if (!scope) {
    scope = resolveScope(req, rollUpKey, operation);
    byKey.set(rollUpKey, scope);
  }
  return scope;
}

async function resolveScope(req: Request, rollUpKey: string, operation: string): Promise<OrgLensRollUpScope> {
  const forbidden = (): MicroserviceError =>
    new MicroserviceError('You do not have access to Org Lens data for this roll-up.', 403, 'FORBIDDEN', {
      operation,
      service: 'LFX_V2_SERVICE',
    });
  const unavailable = (error?: unknown, path?: string): MicroserviceError =>
    new MicroserviceError(ORG_ACCESS_UNVERIFIABLE_MESSAGE, 503, 'ROLE_GRANTS_UNAVAILABLE', {
      operation,
      service: 'LFX_V2_SERVICE',
      ...(path ? { path } : {}),
      originalError: error instanceof Error ? error : undefined,
    });

  const rootUid = orgRollUpRootUid(rollUpKey);
  if (rootUid === null) {
    throw ServiceValidationError.forField('orgUid', 'Invalid organization id format', { operation });
  }
  const username = getEffectiveUsername(req);
  if (!username) {
    throw forbidden();
  }

  let roster: AccessAwareOrgsResult;
  try {
    roster = await roleGrants.getAccessAwareOrgs(req, username);
  } catch (error) {
    logger.warning(req, operation, 'Roll-up set lookup failed; cannot verify Org Lens roll-up access', {
      roll_up_key: rollUpKey,
      err: error instanceof Error ? error.message : String(error),
    });
    throw unavailable(error, '/query/resources');
  }
  const rollUpSet = roleGrants.toRollUpSet(roster);
  if (rollUpSet.lookupOutcome === 'failed') {
    throw unavailable(undefined, '/query/resources');
  }

  const grantFamily = rollUpSet.families.find((candidate) => candidate.rootUid === rootUid);
  let family = grantFamily;
  let familyComplete = true;
  let checkAuditor: ((orgUid: string) => Promise<boolean>) | undefined;
  if (roster.isStaff && (await LaunchDarklyServerService.getInstance().isFlagEnabled(req, ORG_LENS_ROLLUP_ENABLED_FLAG, false))) {
    let staffFamily: OrgStaffRollUpFamily | null = null;
    let lookupError: unknown;
    try {
      staffFamily = await roleGrants.getStaffFamily(req, rootUid);
    } catch (error) {
      lookupError = error;
      logger.warning(req, operation, 'Staff family lookup failed; cannot verify Org Lens roll-up access', {
        roll_up_key: rollUpKey,
        err: error instanceof Error ? error.message : String(error),
      });
    }
    if (staffFamily && staffFamily.family.rootUid === rootUid) {
      const orgs = [...staffFamily.family.orgs];
      for (const org of grantFamily?.orgs ?? []) {
        if (!orgs.some((member) => member.uid === org.uid)) orgs.push(org);
      }
      family = { ...staffFamily.family, orgs };
      familyComplete = staffFamily.complete;
      checkAuditor = batchAuditorChecks(
        req,
        orgs.map((org) => org.accountId).filter((uid) => !roster.resolved.has(uid))
      );
    } else if (!grantFamily) {
      throw lookupError === undefined ? forbidden() : unavailable(lookupError, '/query/resources');
    } else {
      familyComplete = false;
    }
  }
  if (!family) {
    if (rollUpSet.degraded || roster.staffCheck === 'failed') {
      throw unavailable();
    }
    throw forbidden();
  }

  const sharedRoster = Promise.resolve(roster);
  const checks = await Promise.allSettled(family.orgs.map((org) => assertOrgLensRead(req, org.accountId, operation, sharedRoster, checkAuditor)));
  const members: OrgRollUpSetOrg[] = [];
  checks.forEach((check, index) => {
    if (check.status === 'fulfilled') {
      members.push(family.orgs[index]);
      return;
    }
    if (!(check.reason instanceof MicroserviceError && check.reason.statusCode === 403)) {
      throw check.reason;
    }
  });
  if (members.length === 0) {
    throw forbidden();
  }

  if (members.length < family.orgs.length) {
    logger.debug(req, operation, 'Left organizations the caller cannot read out of the roll-up', {
      roll_up_key: rollUpKey,
      member_count: members.length,
      excluded_count: family.orgs.length - members.length,
    });
  }

  const complete = rollUpSet.lookupOutcome === 'ok' && familyComplete;
  if (!complete) {
    logger.warning(req, operation, 'Roll-up set is partial; serving the verified members of the family', {
      roll_up_key: rollUpKey,
      member_count: members.length,
    });
  }
  return { rollUpKey, rootUid, members, complete };
}

function batchAuditorChecks(req: Request, orgUids: string[]): (orgUid: string) => Promise<boolean> {
  let answers: Promise<Map<string, boolean>> | undefined;
  return (orgUid) => (answers ??= roleGrants.checkAuditorAccess(req, orgUids)).then((byKey) => byKey.get(`${orgUid}#auditor`) === true);
}
