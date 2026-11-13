// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_ACCESS_UNVERIFIABLE_MESSAGE } from '@lfx-one/shared/constants';
import type { AccessAwareOrgsResult, OrgLensRollUpScope, OrgRollUpSetOrg } from '@lfx-one/shared/interfaces';
import { orgRollUpRootUid } from '@lfx-one/shared/utils/org-lens-url.utils';
import type { Request } from 'express';

import { MicroserviceError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { assertOrgLensRead } from './org-lens-read-access.helper';

const roleGrants = new OrgRoleGrantsService();

const scopeByRequest = new WeakMap<Request, Map<string, Promise<OrgLensRollUpScope>>>();

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

  const family = rollUpSet.families.find((candidate) => candidate.rootUid === rootUid);
  if (!family) {
    if (rollUpSet.degraded) {
      throw unavailable();
    }
    throw forbidden();
  }

  const sharedRoster = Promise.resolve(roster);
  const checks = await Promise.allSettled(family.orgs.map((org) => assertOrgLensRead(req, org.accountId, operation, sharedRoster)));
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

  const complete = rollUpSet.lookupOutcome === 'ok';
  if (!complete) {
    logger.warning(req, operation, 'Roll-up set is partial; serving the verified members of the family', {
      roll_up_key: rollUpKey,
      member_count: members.length,
    });
  }
  return { rollUpKey, rootUid, members, complete };
}
