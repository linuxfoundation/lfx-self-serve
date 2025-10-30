// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ActiveWeeksStreakResponse,
  MembershipTierResponse,
  OrganizationContributorsResponse,
  OrganizationEventAttendanceResponse,
  OrganizationMaintainersResponse,
  OrganizationTechnicalCommitteeResponse,
  UserCodeCommitsResponse,
  UserProjectsResponse,
  UserPullRequestsResponse,
} from '@lfx-one/shared/interfaces';
import { catchError, Observable, of } from 'rxjs';

/**
 * Analytics service for fetching analytics data from Snowflake
 * Provides dashboard metrics and visualizations
 */
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private readonly http = inject(HttpClient);

  /**
   * Get active weeks streak data for the current user
   * @returns Observable of active weeks streak response
   */
  public getActiveWeeksStreak(): Observable<ActiveWeeksStreakResponse> {
    return this.http.get<ActiveWeeksStreakResponse>('/api/analytics/active-weeks-streak').pipe(
      catchError((error) => {
        console.error('Failed to fetch active weeks streak:', error);
        return of({
          data: [],
          currentStreak: 0,
          totalWeeks: 0,
        });
      })
    );
  }

  /**
   * Get pull requests merged data for the current user
   * @returns Observable of pull requests merged response
   */
  public getPullRequestsMerged(): Observable<UserPullRequestsResponse> {
    return this.http.get<UserPullRequestsResponse>('/api/analytics/pull-requests-merged').pipe(
      catchError((error) => {
        console.error('Failed to fetch pull requests merged:', error);
        return of({
          data: [],
          totalPullRequests: 0,
          totalDays: 0,
        });
      })
    );
  }

  /**
   * Get code commits data for the current user
   * @returns Observable of code commits response
   */
  public getCodeCommits(): Observable<UserCodeCommitsResponse> {
    return this.http.get<UserCodeCommitsResponse>('/api/analytics/code-commits').pipe(
      catchError((error) => {
        console.error('Failed to fetch code commits:', error);
        return of({
          data: [],
          totalCommits: 0,
          totalDays: 0,
        });
      })
    );
  }

  /**
   * Get user's projects with activity data
   * @param page - Page number (1-based)
   * @param limit - Number of projects per page
   * @returns Observable of user projects response
   */
  public getMyProjects(page: number = 1, limit: number = 10): Observable<UserProjectsResponse> {
    const params = { page: page.toString(), limit: limit.toString() };
    return this.http.get<UserProjectsResponse>('/api/analytics/my-projects', { params }).pipe(
      catchError((error) => {
        console.error('Failed to fetch my projects:', error);
        return of({
          data: [],
          totalProjects: 0,
        });
      })
    );
  }

  /**
   * Get organization-level maintainer and project statistics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of organization maintainers response
   */
  public getOrganizationMaintainers(accountId?: string): Observable<OrganizationMaintainersResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationMaintainersResponse>('/api/analytics/organization-maintainers', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization maintainers:', error);
        return of({
          maintainers: 0,
          projects: 0,
          accountId: '',
        });
      })
    );
  }

  /**
   * Get organization-level contributor statistics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of organization contributors response
   */
  public getOrganizationContributors(accountId?: string): Observable<OrganizationContributorsResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationContributorsResponse>('/api/analytics/organization-contributors', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization contributors:', error);
        return of({
          contributors: 0,
          accountId: '',
          accountName: '',
          projects: 0,
        });
      })
    );
  }

  /**
   * Get organization membership tier details
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of membership tier response
   */
  public getMembershipTier(accountId?: string): Observable<MembershipTierResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<MembershipTierResponse>('/api/analytics/membership-tier', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch membership tier:', error);
        return of({
          tier: '',
          membershipStartDate: '',
          membershipEndDate: '',
          membershipPrice: 0,
          membershipStatus: '',
          accountId: '',
        });
      })
    );
  }

  /**
   * Get organization-level event attendance statistics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of organization event attendance response
   */
  public getOrganizationEventAttendance(accountId?: string): Observable<OrganizationEventAttendanceResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationEventAttendanceResponse>('/api/analytics/organization-event-attendance', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization event attendance:', error);
        return of({
          totalAttendees: 0,
          totalSpeakers: 0,
          totalEvents: 0,
          accountId: '',
          accountName: '',
        });
      })
    );
  }

  /**
   * Get organization-level technical committee participation statistics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of organization technical committee response
   */
  public getOrganizationTechnicalCommittee(accountId?: string): Observable<OrganizationTechnicalCommitteeResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationTechnicalCommitteeResponse>('/api/analytics/organization-technical-committee', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization technical committee:', error);
        return of({
          totalRepresentatives: 0,
          totalProjects: 0,
          accountId: '',
        });
      })
    );
  }
}
