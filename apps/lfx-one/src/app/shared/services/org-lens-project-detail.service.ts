// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Injectable } from '@angular/core';
import type { OrgLensProjectDetailResponse } from '@lfx-one/shared/interfaces';
import { delay, Observable, of } from 'rxjs';

import { getDemoProjectDetail } from './org-lens-project-detail.demo-data';

/** Simulated network latency so the page exercises its loading skeletons. */
const DEMO_LATENCY_MS = 450;

/**
 * Data seam for the Org Lens · Project Detail sub-page (LFXV2-1885).
 *
 * Currently returns demo company fixtures (`null` for an unknown slug → 404 state). Wiring
 * the real Snowflake / LFX Insights backend (a separate story) only replaces this method
 * body with an `HttpClient` call to `/api/orgs/:orgUid/lens/projects/:projectSlug` — the
 * response shape and every consumer stay the same.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectDetailService {
  public getProjectDetail(orgUid: string, orgName: string, projectSlug: string): Observable<OrgLensProjectDetailResponse | null> {
    return of(getDemoProjectDetail(orgUid, orgName, projectSlug)).pipe(delay(DEMO_LATENCY_MS));
  }
}
