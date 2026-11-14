// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CampaignAudienceStatus } from '@lfx-one/shared/interfaces';

/**
 * Narrow the upstream audience status string onto the closed union.
 *
 * Upstream declares `Enum("building", "built", "failed")`, but a wire string is only ever a
 * claim. Anything unrecognised becomes `failed` rather than being passed through: `canStageEmail`
 * admits only `built`, so an unknown value must not be able to masquerade as a usable audience,
 * and `failed` is the arm that offers the operator a rebuild.
 *
 * Shared rather than private to one service because THREE call sites now coerce this same field —
 * the audience build, the audience read-back, and the audience-builder proxy's recorded compose.
 * Two copies of a defaulting rule is how one of them ends up admitting a status the others refuse.
 */
export function toAudienceStatus(status: string): CampaignAudienceStatus {
  return status === 'built' || status === 'building' ? status : 'failed';
}
