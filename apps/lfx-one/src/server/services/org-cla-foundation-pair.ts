// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SALESFORCE_ID_PATTERN } from '@lfx-one/shared/constants';
import type { Request } from 'express';

import { logger } from './logger.service';
import type { OrgClaService } from './org-cla.service';

/**
 * Server-side validation that the `foundationSfid` the browser attached to a permission preview
 * actually belongs to the CLA Group the project id resolves to for this organization.
 *
 * The preview endpoint accepts an opaque pair of ids from the client, interpolates them into ACS
 * strings, and asks whether the viewer holds either. Without this guard an impersonator or a
 * tampered client could probe the viewer's grants on any `(project, foundation)` pair by sending
 * `foundationSfid` for a foundation the resolved CLA Group does not sit under — turning the
 * preview into an authorization-exploration oracle. We re-derive the authoritative pair from the
 * organization's own CLA Group list and only pass the client's value through when it matches.
 *
 * Fail-closed on any uncertainty — drop the foundation half and let ACS answer the project pair
 * alone — rather than 5xx-ing a preview the controller has already promised to answer as a 200
 * with `{ allowed }`. The failures we silently degrade are:
 *   - the client sent no foundation id, or sent an empty / malformed one;
 *   - the foundation id equals the project id (nothing to validate; `OrgClaPermissionsService`
 *     collapses the duplicate pair itself);
 *   - no row on the organization's CLA Group list matches `projectSfid` on its ACS pair;
 *   - the matching row carries no `foundationSfid` of its own, or carries a different one;
 *   - the `listClaGroups` upstream call throws.
 *
 * The dropped-foundation case is a user-visible denial (the viewer may still hold the project
 * pair, in which case ACS allows), not a hidden error.
 */
export async function sanitizeFoundationSfid(
  req: Request,
  orgClaService: Pick<OrgClaService, 'listClaGroups'>,
  orgUid: string,
  projectSfid: string | undefined,
  foundationSfid: string | undefined
): Promise<string | undefined> {
  if (!foundationSfid || !SALESFORCE_ID_PATTERN.test(foundationSfid)) return undefined;
  if (!projectSfid || !SALESFORCE_ID_PATTERN.test(projectSfid)) return undefined;
  // Nothing to validate — the service collapses the duplicate pair before posting to ACS.
  if (foundationSfid === projectSfid) return undefined;

  try {
    const { claGroups } = await orgClaService.listClaGroups(req, orgUid);
    // Match the full pair rather than first-row-on-project: if an org has two rows for the same
    // project under different foundations, a legitimate client pair on the second row would be
    // dropped by a project-only `find`, denying a foundation-only manager their write controls.
    const match = claGroups.find((group) => group.pairProjectSfid === projectSfid && group.foundationSfid === foundationSfid);
    return match ? foundationSfid : undefined;
  } catch (error: unknown) {
    // Upstream failure: we cannot verify the pair, so we cannot trust the client's foundation id.
    // ACS still answers the project pair alone — the exact degradation the preview endpoint's
    // "no 5xx on preview" contract calls for. Log fail-closed so an outage of the CLA Group list
    // is distinguishable from a client that sent a foundation the row does not sit under; mirrors
    // the sibling fail-closed log in `OrgClaPermissionsService.check`.
    logger.warning(req, 'check_org_cla_permission', 'Foundation pair verification failed closed', {
      org_uid: orgUid,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return undefined;
  }
}
