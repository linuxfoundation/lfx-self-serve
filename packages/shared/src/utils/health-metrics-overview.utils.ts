// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HEALTH_METRICS_OVERVIEW_LINK_TARGETS } from '../constants/health-metrics-overview.constants';

/**
 * Resolves an `hm_findings.link_target` key to a full PCC URL: `{pccBaseUrl}/project/{pccProjectId}
 * /reports/health-metrics{anchor}`. `pccBaseUrl` is passed in by the caller (e.g. `environment.urls.pcc`)
 * so this package stays environment-agnostic. Returns `undefined` for an unrecognized key (including
 * `code.insights`, which opens externally via `buildLensAwareInsightsUrl` instead) so a caller never
 * renders a broken link.
 */
export function buildHealthMetricsOverviewPccUrl(pccBaseUrl: string, pccProjectId: string, linkTarget: string): string | undefined {
  const anchor = (HEALTH_METRICS_OVERVIEW_LINK_TARGETS as Record<string, string>)[linkTarget];
  if (!anchor) {
    return undefined;
  }
  const base = pccBaseUrl.endsWith('/') ? pccBaseUrl.slice(0, -1) : pccBaseUrl;
  return `${base}/project/${pccProjectId}/reports/health-metrics${anchor}`;
}
