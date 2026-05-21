// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, Observable, of } from 'rxjs';

import type {
  OrgFoundationCoverageResponse,
  OrgInvolvementCertifiedEmployeesMonthlyResponse,
  OrgInvolvementContributorsMonthlyResponse,
  OrgInvolvementEventAttendanceMonthlyResponse,
  OrgInvolvementMaintainersMonthlyResponse,
  OrgTrainingEnrollmentsResponse,
} from '@lfx-one/shared/interfaces';

@Injectable({
  providedIn: 'root',
})
export class OrgInvolvementAnalyticsService {
  private readonly http = inject(HttpClient);

  public getFoundationCoverage(accountId: string): Observable<OrgFoundationCoverageResponse> {
    return this.http.get<OrgFoundationCoverageResponse>('/api/analytics/org-foundation-coverage', { params: { accountId } }).pipe(
      catchError(() =>
        of({
          accountId: '',
          foundationCount: 0,
          foundations: [],
        })
      )
    );
  }

  public getContributorsMonthly(accountId: string): Observable<OrgInvolvementContributorsMonthlyResponse> {
    return this.http.get<OrgInvolvementContributorsMonthlyResponse>('/api/analytics/org-involvement-contributors-monthly', { params: { accountId } }).pipe(
      catchError(() =>
        of({
          accountId: '',
          totalActiveContributors: 0,
          monthlyData: [],
          monthlyLabels: [],
        })
      )
    );
  }

  public getMaintainersMonthly(accountId: string): Observable<OrgInvolvementMaintainersMonthlyResponse> {
    return this.http.get<OrgInvolvementMaintainersMonthlyResponse>('/api/analytics/org-involvement-maintainers-monthly', { params: { accountId } }).pipe(
      catchError(() =>
        of({
          accountId: '',
          accountName: '',
          totalMaintainersYearly: 0,
          totalProjectsYearly: 0,
          monthlyData: [],
          monthlyLabels: [],
        })
      )
    );
  }

  public getEventAttendanceMonthly(accountId: string): Observable<OrgInvolvementEventAttendanceMonthlyResponse> {
    return this.http
      .get<OrgInvolvementEventAttendanceMonthlyResponse>('/api/analytics/org-involvement-event-attendance-monthly', { params: { accountId } })
      .pipe(
        catchError(() =>
          of({
            accountId: '',
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

  public getCertifiedEmployeesMonthly(accountId: string): Observable<OrgInvolvementCertifiedEmployeesMonthlyResponse> {
    return this.http
      .get<OrgInvolvementCertifiedEmployeesMonthlyResponse>('/api/analytics/org-involvement-certified-employees-monthly', { params: { accountId } })
      .pipe(
        catchError(() =>
          of({
            accountId: '',
            totalCertifications: 0,
            totalCertifiedEmployees: 0,
            monthlyData: [],
            monthlyLabels: [],
          })
        )
      );
  }

  public getTrainingEnrollments(accountId: string): Observable<OrgTrainingEnrollmentsResponse> {
    return this.http.get<OrgTrainingEnrollmentsResponse>('/api/analytics/org-involvement-training-enrollments', { params: { accountId } }).pipe(
      catchError(() =>
        of({
          accountId: '',
          totalEnrollments: 0,
          dailyData: [],
        })
      )
    );
  }
}
