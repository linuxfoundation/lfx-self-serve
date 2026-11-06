// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';

import type {
  OrgFoundationCoverageResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgInvolvementMaintainersMonthlyResponse,
} from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class OrgInvolvementAnalyticsService {
  private readonly http = inject(HttpClient);

  public getFoundationCoverage(accountId: string): Observable<OrgFoundationCoverageResponse> {
    return this.http
      .get<OrgFoundationCoverageResponse>('/api/analytics/org-foundation-coverage', { params: { accountId } })
      .pipe(catchError(() => of({ accountId, foundationCount: 0, foundations: [] })));
  }

  public getContributorsMonthly(accountId: string): Observable<OrgInvolvementContributorsMonthlyResponse> {
    return this.http
      .get<OrgInvolvementContributorsMonthlyResponse>('/api/analytics/org-involvement-contributors-monthly', { params: { accountId } })
      .pipe(catchError(() => of({ accountId, totalActiveContributors: 0, monthlyData: [], monthlyLabels: [] })));
  }

  public getMaintainersMonthly(accountId: string): Observable<OrgInvolvementMaintainersMonthlyResponse> {
    return this.http
      .get<OrgInvolvementMaintainersMonthlyResponse>('/api/analytics/org-involvement-maintainers-monthly', { params: { accountId } })
      .pipe(catchError(() => of({ accountId, maintainerRoles: null, monthlyData: [], monthlyLabels: [] })));
  }

  public getEventAttendanceMonthly(accountId: string): Observable<OrgInvolvementEventAttendanceMonthlyResponse> {
    return this.http
      .get<OrgInvolvementEventAttendanceMonthlyResponse>('/api/analytics/org-involvement-event-attendance-monthly', { params: { accountId } })
      .pipe(
        catchError(() =>
          of({
            accountId,
            accountName: '',
            totalAttended: 0,
            totalSpeakers: 0,
            attendeesMonthlyData: [],
            speakersMonthlyData: [],
            monthlyLabels: [],
          })
        )
      );
  }
}
