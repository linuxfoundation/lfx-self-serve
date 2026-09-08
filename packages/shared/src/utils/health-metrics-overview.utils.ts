// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_OVERVIEW_LINK_TARGETS } from '../constants/health-metrics-overview.constants';

import type { HealthMetricsOverviewLinkTarget } from '../interfaces/health-metrics-overview.interface';

/**
 * Resolves an `hm_findings.link_target` key to a full PCC URL: `{pccBaseUrl}/project/{pccProjectId}
 * /reports/health-metrics{anchor}`. `pccBaseUrl` is passed in by the caller (e.g. `environment.urls.pcc`)
 * so this package stays environment-agnostic. Returns `undefined` for `code.insights` (which opens
 * externally via `buildLensAwareInsightsUrl` instead) or a missing `pccProjectId`, so a caller never
 * renders a broken link.
 */
export function buildHealthMetricsOverviewPccUrl(pccBaseUrl: string, pccProjectId: string, linkTarget: HealthMetricsOverviewLinkTarget): string | undefined {
  const anchor =
    linkTarget in HEALTH_METRICS_OVERVIEW_LINK_TARGETS
      ? HEALTH_METRICS_OVERVIEW_LINK_TARGETS[linkTarget as keyof typeof HEALTH_METRICS_OVERVIEW_LINK_TARGETS]
      : undefined;
  if (!anchor || !pccProjectId) {
    return undefined;
  }
  const base = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
  return `${base}/project/${encodeURIComponent(pccProjectId)}/reports/health-metrics${anchor}`;
}
