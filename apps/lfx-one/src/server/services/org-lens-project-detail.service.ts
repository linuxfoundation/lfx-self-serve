// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensProjectDetailResponse } from '@lfx-one/shared/interfaces';

import { getDemoProjectDetail } from './org-lens-project-detail.demo-data';

/**
 * Server-side data seam for the Org Lens · Project Detail sub-page (LFXV2-1885).
 *
 * Currently serves demo company fixtures keyed by `projectSlug` (`null` → 404).
 * Wiring the real Snowflake / LFX Insights backend (a separate story) only replaces
 * this method body with actual Snowflake queries — the response shape and every
 * consumer stay the same.
 */
export class OrgLensProjectDetailService {
  public getProjectDetail(orgUid: string, orgName: string, projectSlug: string): OrgLensProjectDetailResponse | null {
    return getDemoProjectDetail(orgUid, orgName, projectSlug);
  }
}
