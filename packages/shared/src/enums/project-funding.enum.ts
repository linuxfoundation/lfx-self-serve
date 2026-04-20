// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project funding status, synced from SFDC `funding__c` via lfx-v1-sync-helper.
 * Values mirror the upstream Goa enum declared in `lfx-v2-project-service` at
 * `api/project/v1/design/types.go` (`ProjectFundingAttribute`).
 */
export enum ProjectFunding {
  Funded = 'Funded',
  Unfunded = 'Unfunded',
  SupportedByParent = 'Supported by Parent Project',
}
