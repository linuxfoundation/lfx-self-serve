// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, MicroserviceError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgRoleGrantsService } from '../services/org-role-grants.service';
import { getEffectiveUsername } from '../utils/auth-helper';

const roleGrantsService = new OrgRoleGrantsService();

/**
 * Requires the caller to hold an Org Lens relation (writer/auditor, direct or inherited) on the
 * organization named in the route, before any `/api/orgs/:orgUid/lens/*` read runs.
 *
 * Without this, the org identifier in the URL is the only thing scoping the response, and it is
 * supplied by the caller — so any authenticated user could read any organization's roster,
 * memberships and person-level detail. A `WHERE account_id = ?` predicate on the analytics query is
 * a data filter, not an authorization check (ADR-0038 (a)); this middleware supplies the missing
 * operational-plane gate, matching what the sibling lenses already require for the same facts.
 *
 * Failure semantics mirror `OrgLensAccessService.assertCanManage`, which is the established pattern
 * for this app: 403 only when the caller is *verified* to lack the relation, and a retriable 503
 * when the grants lookup itself could not be completed — a transient upstream outage must not
 * masquerade as "no permission", and equally must not fall open.
 */
export async function requireOrgLensAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const orgUid = req.params['orgUid'];

  try {
    const username = getEffectiveUsername(req);
    if (!username) {
      next(
        new AuthorizationError('Authentication is required to view organization data.', {
          operation: 'require_org_lens_access',
          service: 'authorization',
          path: req.path,
          code: 'ORG_LENS_ACCESS_REQUIRED',
        })
      );
      return;
    }

    const { resolved, upstreamFailed } = await roleGrantsService.getAccessAwareOrgs(req, username);

    // Fail closed but retriable: we could not establish what the caller may see, so we neither serve
    // the data nor claim they are unauthorized.
    if (upstreamFailed) {
      logger.warning(req, 'require_org_lens_access', 'Role-grants lookup failed; refusing the read as retriable', {
        org_uid: orgUid,
      });
      next(
        new MicroserviceError('Could not verify your access to this organization. Please try again.', 503, 'ORG_LENS_ACCESS_UNVERIFIED', {
          operation: 'require_org_lens_access',
          service: 'authorization',
          path: req.path,
        })
      );
      return;
    }

    // `resolved` holds every org the caller can see — direct writer, direct auditor, and children
    // inherited from a direct-granted parent — so membership in it is the whole check.
    if (orgUid && resolved.has(orgUid)) {
      next();
      return;
    }

    logger.warning(req, 'require_org_lens_access', 'Caller requested an organization they hold no relation on', {
      org_uid: orgUid,
      granted_org_count: resolved.size,
    });
    next(
      new AuthorizationError('You do not have access to this organization.', {
        operation: 'require_org_lens_access',
        service: 'authorization',
        path: req.path,
        code: 'ORG_LENS_ACCESS_REQUIRED',
      })
    );
  } catch (error) {
    next(error);
  }
}
