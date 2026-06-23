// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CommitteeOrganizationReference } from './committee.interface';

export interface InviteTokenPayload {
  email: string;
  exp: number;
  iat: number;
  jti: string;
  invite_uid: string;
  resource_uid: string;
  return_url: string;
  role: string;
}

/**
 * A committee invite that could not be auto-accepted during the LFID invite flow because
 * the committee requires an organization but none was pre-filled on the invite. The client
 * must collect the organization from the user and accept the invite manually.
 */
export interface PendingCommitteeInviteForOrg {
  committee_uid: string;
  invite_uid: string;
  /** Committee display name for the org dialog header */
  committee_name: string;
  /** Pre-fill value if the invite already carries a suggested organization */
  organization?: CommitteeOrganizationReference | null;
}

export interface AcceptInviteResponse {
  return_url: string;
  /**
   * Present when a committee invite requires an organization on acceptance but none was
   * pre-filled on the invite. The client should collect the org from the user and call
   * POST /api/committees/:committee_uid/invites/:invite_uid/accept before redirecting.
   */
  pending_committee_invite?: PendingCommitteeInviteForOrg;
}
