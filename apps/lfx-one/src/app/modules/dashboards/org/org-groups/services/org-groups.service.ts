// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Injectable } from '@angular/core';
import { of, type Observable } from 'rxjs';

import type { OrgGroup, OrgGroupDetail, OrgGroupsStats } from '@lfx-one/shared/interfaces';

import { ORG_GROUPS_DEMO_DATA, ORG_GROUPS_DEMO_STATS } from './org-groups-demo.data';
import { getGroupDetailDemo } from './org-group-detail-demo.data';

@Injectable({ providedIn: 'root' })
export class OrgGroupsService {
  /** Returns the demo groups roster. Real implementation will call the LFX Groups BFF endpoint. */
  public getGroups(): Observable<readonly OrgGroup[]> {
    return of(ORG_GROUPS_DEMO_DATA);
  }

  /** Returns aggregate stats for the KPI cards. Real implementation will call the LFX Groups aggregations endpoint. */
  public getStats(): Observable<OrgGroupsStats> {
    return of(ORG_GROUPS_DEMO_STATS);
  }

  /**
   * Returns group detail for the given id, or null if the group doesn't exist or the viewer
   * lacks access to a private group. Real implementation will call the LFX Groups BFF detail
   * endpoint, which will enforce this same visibility/membership scoping server-side.
   */
  public getGroupDetail(id: string): Observable<OrgGroupDetail | null> {
    return of(getGroupDetailDemo(id));
  }
}
