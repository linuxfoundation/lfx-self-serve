// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The env var listing the platforms on which "create another campaign" is offered (#4983, "ss-3"):
 * comma-separated platform ids, default empty (feature off). Narrowed to the platforms campaign-service
 * supports it for (`CAMPAIGN_SERVICE_MULTI_CAMPAIGN_CAPABLE_PLATFORMS`). An argocd values change adds a
 * platform alongside the campaign-service release that supports it; removing it is the rollback lever.
 */
export const MULTI_CAMPAIGN_PLATFORMS_ENV = 'LFX_CUTOVER_CAMPAIGN_SERVICE_MULTI_CAMPAIGN_PLATFORMS';
