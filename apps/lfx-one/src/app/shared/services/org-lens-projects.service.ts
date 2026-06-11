// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Injectable } from '@angular/core';
import type { OrgLensProject, OrgLensProjectsResponse } from '@lfx-one/shared/interfaces';
import { delay, Observable, of } from 'rxjs';

import { buildAddedProjects, getAddableProjectOptions, getDemoProjectsResponse } from './org-lens-projects.demo-data';

/** Simulated network latency so the page exercises its loading skeletons. */
const DEMO_LATENCY_MS = 450;

/**
 * Data seam for the Org Lens Projects page (LFXV2-1883 / LFXV2-1884).
 *
 * Currently returns demo company fixtures. Wiring the real Snowflake / LFX Insights
 * backend (a separate story) only replaces this method body with an `HttpClient` call
 * to `/api/orgs/:orgUid/lens/projects` — the response shape and every consumer stay the
 * same. See `OrgLensTrainingService` for the eventual HTTP pattern.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensProjectsService {
  public getProjects(orgUid: string, orgName: string): Observable<OrgLensProjectsResponse> {
    return of(getDemoProjectsResponse(orgUid, orgName)).pipe(delay(DEMO_LATENCY_MS));
  }

  /** Catalog of projects that can be added to a workspace (`{ value, label, logoUrl }` for the multi-select). */
  public getAddableProjectOptions(): { value: string; label: string; logoUrl: string }[] {
    return getAddableProjectOptions();
  }

  /** Build full project rows for the given catalog slugs (used when the user adds projects to a workspace). */
  public buildAddedProjects(slugs: readonly string[]): OrgLensProject[] {
    return buildAddedProjects(slugs);
  }
}
