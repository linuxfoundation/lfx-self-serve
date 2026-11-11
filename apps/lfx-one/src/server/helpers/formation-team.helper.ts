// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FORMATION_TEAM_NAME } from '@lfx-one/shared/constants';

import type { Request } from 'express';

import type { AccessCheckService } from '../services/access-check.service';

/**
 * Whether the caller is a `member` of `team:formation` (GH-2705) — the caller-scoped check the
 * gateway's `set_item_status` rule runs and that gates the formation record edit (#5134). No
 * resource in the object: the question is "is this person on the formation team", not what they
 * hold on any project. Fail-closed: `checkSingleAccess` degrades to `false` on an access-check
 * failure, so an FGA outage hides write controls rather than offering writes that can only 403.
 */
export async function checkFormationTeamMembership(accessCheckService: AccessCheckService, req: Request): Promise<boolean> {
  return accessCheckService.checkSingleAccess(req, { resource: 'team', id: FORMATION_TEAM_NAME, access: 'member' });
}
