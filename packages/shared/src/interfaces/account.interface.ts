// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Account entity representing an organization in the system
 * @description Maps account ID to organization name for board member dashboard
 */
export interface Account {
  /** Unique account identifier */
  accountId: string;
  /** Organization display name */
  accountName: string;
}
