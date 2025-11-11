// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ActiveWeeksStreakResponse,
  BoardMemberDashboardResponse,
  OrganizationContributionsOverviewResponse,
  OrganizationEventsOverviewResponse,
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
   * Get consolidated organization contributions overview (maintainers + contributors) in a single API call
   * Optimized endpoint that reduces API roundtrips by combining related metrics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of consolidated contributions overview response
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public getOrganizationContributionsOverview(accountId?: string): Observable<OrganizationContributionsOverviewResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationContributionsOverviewResponse>('/api/analytics/organization-contributions-overview', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization contributions overview:', error);
        return of({
          maintainers: {
            maintainers: 0,
            projects: 0,
          },
          contributors: {
            contributors: 0,
            projects: 0,
          },
          technicalCommittee: {
            totalRepresentatives: 0,
            totalProjects: 0,
          },
          accountId: '',
          accountName: '',
        });
      })
    );
  }

  /**
   * Get consolidated board member dashboard data (membership tier + certified employees + board meeting attendance)
   * Optimized endpoint that reduces API roundtrips by combining related metrics in a single API call
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of consolidated board member dashboard response
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public getBoardMemberDashboard(accountId?: string): Observable<BoardMemberDashboardResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<BoardMemberDashboardResponse>('/api/analytics/board-member-dashboard', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch board member dashboard:', error);
        return of({
          membershipTier: {
            tier: '',
            membershipStartDate: '',
            membershipEndDate: '',
            membershipStatus: '',
          },
          certifiedEmployees: {
            certifications: 0,
            certifiedEmployees: 0,
          },
          boardMeetingAttendance: {
            totalMeetings: 0,
            attendedMeetings: 0,
            notAttendedMeetings: 0,
            attendancePercentage: 0,
          },
          accountId: '',
          projectId: '',
        });
      })
    );
  }

  /**
   * Get consolidated organization events overview (event attendance + event sponsorships) in a single API call
   * Optimized endpoint that reduces API roundtrips by combining related event metrics
   * @param accountId - Optional account ID to filter by specific organization
   * @returns Observable of consolidated events overview response
   *
   * Generated with [Claude Code](https://claude.ai/code)
   */
  public getOrganizationEventsOverview(accountId?: string): Observable<OrganizationEventsOverviewResponse> {
    const options = accountId ? { params: { accountId } } : {};
    return this.http.get<OrganizationEventsOverviewResponse>('/api/analytics/organization-events-overview', options).pipe(
      catchError((error) => {
        console.error('Failed to fetch organization events overview:', error);
        return of({
          eventAttendance: {
            totalAttendees: 0,
            totalSpeakers: 0,
            totalEvents: 0,
            accountName: '',
          },
          accountId: '',
          projectId: '',
        });
      })
    );
  }
}
