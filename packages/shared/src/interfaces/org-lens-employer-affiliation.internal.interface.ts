// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * #4314 — one warehouse row behind the employer-membership lookup: a Salesforce account whose
 * normalized name matched one of the caller's current employers, and how many active memberships it
 * holds. Internal to the BFF read; the wire contract (`OrgLensEmployerAffiliation`) carries neither
 * the account id nor the count.
 */
export interface OrgLensEmployerMembershipWarehouseRow {
  ACCOUNT_ID: string;
  ACCOUNT_NAME: string;
  ACTIVE_MEMBERSHIP_COUNT: number;
}
