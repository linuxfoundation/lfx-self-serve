// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ActiveWeeksStreakResponse,
  CertifiedEmployeesResponse,
  CodeCommitsDailyResponse,
  FoundationActiveContributorsMonthlyResponse,
  FoundationCompanyBusFactorResponse,
  FoundationContributorsMentoredResponse,
  FoundationContributorsDistributionResponse,
  FoundationHealthScoreDistributionResponse,
  FoundationEventsAttendanceDistributionResponse,
  FoundationEventsQuarterlyResponse,
  FoundationMaintainersDistributionResponse,
  FoundationMaintainersMonthlyResponse,
  FoundationMaintainersResponse,
  FoundationSoftwareValueResponse,
  FoundationValueConcentrationResponse,
  FoundationTotalMembersResponse,
  FoundationProjectsDetailResponse,
  FoundationProjectsLifecycleDistributionResponse,
  FoundationTotalProjectsResponse,
  HealthEventsMonthlyResponse,
  HealthMetricsDailyResponse,
  MembershipTierResponse,
  OrgContributorsMonthlyResponse,
  OrgContributorsProjectDistributionResponse,
  OrgEventAttendeesMonthlyResponse,
  OrgEventSpeakersMonthlyResponse,
  OrgCertifiedEmployeesDistributionResponse,
  OrgCertifiedEmployeesMonthlyResponse,
  OrgTrainingEnrollmentsDistributionResponse,
  OrgTrainingEnrollmentsMonthlyResponse,
  OrgMaintainersDistributionResponse,
  OrgMaintainersKeyMembersResponse,
  OrgMaintainersMonthlyResponse,
  OrganizationContributorsResponse,
  OrganizationEventAttendanceMonthlyResponse,
  OrganizationMaintainersResponse,
  ProjectIssuesResolutionResponse,
  ProjectPullRequestsWeeklyResponse,
  TrainingEnrollmentsResponse,
  UniqueContributorsDailyResponse,
  UniqueContributorsWeeklyResponse,
  UserCodeCommitsResponse,
  UserProjectsResponse,
  UserPullRequestsResponse,
  EmailCtrResponse,
  EngagedCommunitySizeResponse,
  FlywheelConversionResponse,
  MemberAcquisitionResponse,
  MemberRetentionResponse,
  MembershipChurnPerTierSummaryResponse,
  NpsSummaryResponse,
  OutstandingBalanceSummaryResponse,
  EventsSummaryResponse,
  ParticipatingOrgsSummaryResponse,
  TrainingCertificationSummaryResponse,
  CodeContributionSummaryResponse,
  SocialMediaResponse,
  SocialReachResponse,
  WebActivitiesSummaryResponse,
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
      catchError(() => {
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
      catchError(() => {
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
      catchError(() => {
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
   * @returns Observable of user projects response
   */
  public getMyProjects(): Observable<UserProjectsResponse> {
    return this.http.get<UserProjectsResponse>('/api/analytics/my-projects').pipe(
      catchError(() => {
        return of({
          data: [],
          totalProjects: 0,
        });
      })
    );
  }

  /**
   * Get organization maintainers data with monthly trend
   * @param accountId - Required account ID to filter by specific organization
   * @param foundationSlug - Required foundation slug to filter by
   * @returns Observable of organization maintainers response with monthly data
   */
  public getOrganizationMaintainers(accountId: string, foundationSlug: string): Observable<OrganizationMaintainersResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrganizationMaintainersResponse>('/api/analytics/organization-maintainers', { params }).pipe(
      catchError(() => {
        return of({
          maintainers: 0,
          projects: 0,
          accountId: '',
          accountName: '',
          monthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get organization contributors data with monthly trend
   * @param accountId - Required account ID to filter by specific organization
   * @param foundationSlug - Required foundation slug to filter data
   * @returns Observable of organization contributors response
   */
  public getOrganizationContributors(accountId: string, foundationSlug: string): Observable<OrganizationContributorsResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrganizationContributorsResponse>('/api/analytics/organization-contributors', { params }).pipe(
      catchError(() => {
        return of({
          contributors: 0,
          accountId: '',
          accountName: '',
          monthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get membership tier data for an organization
   * @param accountId - Required account ID to filter by specific organization
   * @param projectSlug - Required foundation project slug to filter data
   * @returns Observable of membership tier response
   */
  public getMembershipTier(accountId: string, projectSlug: string): Observable<MembershipTierResponse> {
    const params = { accountId, projectSlug };
    return this.http.get<MembershipTierResponse>('/api/analytics/membership-tier', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          projectName: '',
          projectSlug: '',
          isProjectActive: false,
          accountId: '',
          accountName: '',
          membershipTier: '',
          membershipPrice: 0,
          startDate: '',
          endDate: '',
          renewalPrice: 0,
          membershipStatus: '',
        });
      })
    );
  }

  /**
   * Get certified employees data for an organization with monthly trend
   * @param accountId - Required account ID to filter by specific organization
   * @param foundationSlug - Required foundation slug to filter data
   * @returns Observable of certified employees response
   */
  public getCertifiedEmployees(accountId: string, foundationSlug: string): Observable<CertifiedEmployeesResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<CertifiedEmployeesResponse>('/api/analytics/certified-employees', { params }).pipe(
      catchError(() => {
        return of({
          certifications: 0,
          certifiedEmployees: 0,
          accountId: '',
          monthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get training enrollments data for an organization
   * @param accountId - Required account ID to filter by specific organization
   * @param projectSlug - Required foundation project slug to filter data
   * @returns Observable of training enrollments response with cumulative daily data
   */
  public getTrainingEnrollments(accountId: string, projectSlug: string): Observable<TrainingEnrollmentsResponse> {
    const params = { accountId, projectSlug };
    return this.http.get<TrainingEnrollmentsResponse>('/api/analytics/training-enrollments', { params }).pipe(
      catchError(() => {
        return of({
          totalEnrollments: 0,
          dailyData: [],
          accountId: '',
          projectSlug: '',
        });
      })
    );
  }

  /**
   * Get event attendance monthly data for an organization with cumulative trends
   * Returns separate data for event attendees and event speakers charts
   * @param accountId - Required account ID to filter by specific organization
   * @param foundationSlug - Required foundation slug to filter data
   * @returns Observable of event attendance monthly response with cumulative monthly data
   */
  public getEventAttendanceMonthly(accountId: string, foundationSlug: string): Observable<OrganizationEventAttendanceMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrganizationEventAttendanceMonthlyResponse>('/api/analytics/event-attendance-monthly', { params }).pipe(
      catchError(() => {
        return of({
          totalAttended: 0,
          totalSpeakers: 0,
          accountId: '',
          accountName: '',
          attendeesMonthlyData: [],
          speakersMonthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get per-project detail rows for the total projects drill-down drawer
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationProjectsDetail(foundationSlug: string): Observable<FoundationProjectsDetailResponse> {
    return this.http.get<FoundationProjectsDetailResponse>('/api/analytics/foundation-projects-detail', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({ projects: [], totalCount: 0 });
      })
    );
  }

  /**
   * Get lifecycle stage distribution for the total projects drill-down drawer
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationProjectsLifecycleDistribution(foundationSlug: string): Observable<FoundationProjectsLifecycleDistributionResponse> {
    return this.http
      .get<FoundationProjectsLifecycleDistributionResponse>('/api/analytics/foundation-projects-lifecycle-distribution', { params: { foundationSlug } })
      .pipe(
        catchError(() => {
          return of({ distribution: [] });
        })
      );
  }

  /**
   * Get monthly average active contributors for a foundation (last 12 months)
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationActiveContributorsMonthly(foundationSlug: string): Observable<FoundationActiveContributorsMonthlyResponse> {
    return this.http
      .get<FoundationActiveContributorsMonthlyResponse>('/api/analytics/foundation-active-contributors-monthly', { params: { foundationSlug } })
      .pipe(catchError(() => of({ monthlyData: [], monthlyLabels: [] })));
  }

  /**
   * Get contributor distribution by percentile band for a foundation
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationContributorsDistribution(foundationSlug: string): Observable<FoundationContributorsDistributionResponse> {
    return this.http
      .get<FoundationContributorsDistributionResponse>('/api/analytics/foundation-contributors-distribution', { params: { foundationSlug } })
      .pipe(catchError(() => of({ distribution: [] })));
  }

  public getFoundationTotalProjects(foundationSlug: string): Observable<FoundationTotalProjectsResponse> {
    return this.http.get<FoundationTotalProjectsResponse>('/api/analytics/foundation-total-projects', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalProjects: 0,
          monthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get total members count for a foundation from Snowflake
   * @param foundationSlug - Required foundation slug to filter members (e.g., 'tlf', 'cncf')
   * @returns Observable of foundation total members response with cumulative monthly data
   */
  public getFoundationTotalMembers(foundationSlug: string): Observable<FoundationTotalMembersResponse> {
    return this.http.get<FoundationTotalMembersResponse>('/api/analytics/foundation-total-members', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalMembers: 0,
          monthlyData: [],
          monthlyLabels: [],
        });
      })
    );
  }

  /**
   * Get foundation software value and top projects from Snowflake
   * @param foundationSlug - Required foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Observable of foundation software value response with total value and top projects
   */
  public getFoundationSoftwareValue(foundationSlug: string): Observable<FoundationSoftwareValueResponse> {
    return this.http.get<FoundationSoftwareValueResponse>('/api/analytics/foundation-software-value', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalValue: 0,
          topProjects: [],
        });
      })
    );
  }

  /**
   * Get foundation value concentration data from Snowflake
   * @param foundationSlug - Required foundation slug to filter by
   * @returns Observable of foundation value concentration response
   */
  public getFoundationValueConcentration(foundationSlug: string): Observable<FoundationValueConcentrationResponse> {
    return this.http.get<FoundationValueConcentrationResponse>('/api/analytics/foundation-value-concentration', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalValue: 0,
          top1Value: 0,
          top3Value: 0,
          top5Value: 0,
          allOtherValue: 0,
          totalProjectsCount: 0,
          top1Percentage: 0,
          top3Percentage: 0,
          top5Percentage: 0,
          allOtherPercentage: 0,
        });
      })
    );
  }

  /**
   * Get foundation maintainers data from Snowflake
   * @param foundationSlug - Required foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Observable of foundation maintainers response with average and daily trend data
   */
  public getFoundationMaintainers(foundationSlug: string): Observable<FoundationMaintainersResponse> {
    return this.http.get<FoundationMaintainersResponse>('/api/analytics/foundation-maintainers', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          avgMaintainers: 0,
          trendData: [],
          trendLabels: [],
        });
      })
    );
  }

  /**
   * Get monthly maintainer counts for a foundation (last 12 months, all repos aggregated)
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationMaintainersMonthly(foundationSlug: string): Observable<FoundationMaintainersMonthlyResponse> {
    return this.http
      .get<FoundationMaintainersMonthlyResponse>('/api/analytics/foundation-maintainers-monthly', { params: { foundationSlug } })
      .pipe(catchError(() => of({ monthlyData: [], monthlyLabels: [] })));
  }

  /**
   * Get maintainer contribution distribution by percentile band for a foundation
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationMaintainersDistribution(foundationSlug: string): Observable<FoundationMaintainersDistributionResponse> {
    return this.http
      .get<FoundationMaintainersDistributionResponse>('/api/analytics/foundation-maintainers-distribution', { params: { foundationSlug } })
      .pipe(catchError(() => of({ distribution: [] })));
  }

  /**
   * Get quarterly event counts for a foundation (last 8 quarters)
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationEventsQuarterly(foundationSlug: string): Observable<FoundationEventsQuarterlyResponse> {
    return this.http
      .get<FoundationEventsQuarterlyResponse>('/api/analytics/foundation-events-quarterly', { params: { foundationSlug } })
      .pipe(catchError(() => of({ quarterlyData: [], quarterlyLabels: [] })));
  }

  /**
   * Get event distribution by attendance size bucket for a foundation
   * @param foundationSlug - Required foundation slug (e.g., 'cncf', 'tlf')
   */
  public getFoundationEventsAttendanceDistribution(foundationSlug: string): Observable<FoundationEventsAttendanceDistributionResponse> {
    return this.http
      .get<FoundationEventsAttendanceDistributionResponse>('/api/analytics/foundation-events-attendance-distribution', { params: { foundationSlug } })
      .pipe(catchError(() => of({ distribution: [] })));
  }

  /**
   * Get foundation health score distribution from Snowflake
   * @param foundationSlug - Required foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Observable of foundation health score distribution response
   */
  public getFoundationHealthScoreDistribution(foundationSlug: string): Observable<FoundationHealthScoreDistributionResponse> {
    return this.http.get<FoundationHealthScoreDistributionResponse>('/api/analytics/foundation-health-score-distribution', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          excellent: 0,
          healthy: 0,
          stable: 0,
          unsteady: 0,
          critical: 0,
        });
      })
    );
  }

  /**
   * Get company bus factor data for a foundation
   * @param foundationSlug - Required foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Observable of company bus factor response with top companies concentration metrics
   */
  public getCompanyBusFactor(foundationSlug: string): Observable<FoundationCompanyBusFactorResponse> {
    return this.http.get<FoundationCompanyBusFactorResponse>('/api/analytics/company-bus-factor', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          topCompaniesCount: 0,
          topCompaniesPercentage: 0,
          otherCompaniesCount: 0,
          otherCompaniesPercentage: 0,
        });
      })
    );
  }

  /**
   * Get project issues resolution data (opened vs closed issues) from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Observable of project issues resolution response with aggregated metrics
   */
  public getProjectIssuesResolution(slug: string, entityType: 'foundation' | 'project'): Observable<ProjectIssuesResolutionResponse> {
    const params = { slug, entityType };
    return this.http
      .get<ProjectIssuesResolutionResponse>('/api/analytics/project-issues-resolution', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalOpenedIssues: 0,
            totalClosedIssues: 0,
            resolutionRatePct: 0,
            medianDaysToClose: 0,
            totalDays: 0,
          });
        })
      );
  }

  /**
   * Get project pull requests weekly data (merge velocity) from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (aggregates all projects) or 'project' (single project)
   * @returns Observable of project pull requests weekly response with aggregated metrics
   */
  public getProjectPullRequestsWeekly(slug: string, entityType: 'foundation' | 'project'): Observable<ProjectPullRequestsWeeklyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<ProjectPullRequestsWeeklyResponse>('/api/analytics/project-pull-requests-weekly', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalMergedPRs: 0,
            avgMergeTime: 0,
            totalWeeks: 0,
          });
        })
      );
  }

  /**
   * Get contributors mentored weekly data from Snowflake
   * @param slug - Foundation slug for filtering (always uses foundation_slug)
   * @returns Observable of contributors mentored response with aggregated metrics
   */
  public getContributorsMentored(slug: string): Observable<FoundationContributorsMentoredResponse> {
    const params = { slug };
    return this.http
      .get<FoundationContributorsMentoredResponse>('/api/analytics/contributors-mentored', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalMentored: 0,
            avgWeeklyNew: 0,
            totalWeeks: 0,
          });
        })
      );
  }

  /**
   * Get unique contributors weekly data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (aggregates all projects) or 'project' (single project)
   * @returns Observable of unique contributors weekly response with aggregated metrics
   */
  public getUniqueContributorsWeekly(slug: string, entityType: 'foundation' | 'project'): Observable<UniqueContributorsWeeklyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<UniqueContributorsWeeklyResponse>('/api/analytics/unique-contributors-weekly', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalUniqueContributors: 0,
            avgUniqueContributors: 0,
            totalWeeks: 0,
          });
        })
      );
  }

  /**
   * Get health metrics daily data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Observable of health metrics daily response with current average health score
   */
  public getHealthMetricsDaily(slug: string, entityType: 'foundation' | 'project'): Observable<HealthMetricsDailyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<HealthMetricsDailyResponse>('/api/analytics/health-metrics-daily', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            currentAvgHealthScore: 0,
            totalDays: 0,
          });
        })
      );
  }

  /**
   * Get unique contributors daily data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Observable of unique contributors daily response with average contributors
   */
  public getUniqueContributorsDaily(slug: string, entityType: 'foundation' | 'project'): Observable<UniqueContributorsDailyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<UniqueContributorsDailyResponse>('/api/analytics/unique-contributors-daily', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            avgContributors: 0,
            totalDays: 0,
          });
        })
      );
  }

  /**
   * Get health events monthly data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Observable of health events monthly response with total events
   */
  public getHealthEventsMonthly(slug: string, entityType: 'foundation' | 'project'): Observable<HealthEventsMonthlyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<HealthEventsMonthlyResponse>('/api/analytics/health-events-monthly', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalEvents: 0,
            totalMonths: 0,
          });
        })
      );
  }

  /**
   * Get code commits daily data from Snowflake
   * @param slug - Foundation or project slug
   * @param entityType - Query scope: 'foundation' (foundation-level data) or 'project' (single project data)
   * @returns Observable of code commits daily response with commit metrics
   */
  public getCodeCommitsDaily(slug: string, entityType: 'foundation' | 'project'): Observable<CodeCommitsDailyResponse> {
    const params = { slug, entityType };
    return this.http
      .get<CodeCommitsDailyResponse>('/api/analytics/code-commits-daily', {
        params,
      })
      .pipe(
        catchError(() => {
          return of({
            data: [],
            totalCommits: 0,
            totalDays: 0,
          });
        })
      );
  }

  /**
   * Get monthly unique contributor trend for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org contributors monthly response
   */
  public getOrgContributorsMonthly(accountId: string, foundationSlug: string): Observable<OrgContributorsMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgContributorsMonthlyResponse>('/api/analytics/org-contributors-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalContributors: 0 });
      })
    );
  }

  /**
   * Get top 5 project contributor distribution for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org contributors project distribution response
   */
  public getOrgContributorsProjectDistribution(accountId: string, foundationSlug: string): Observable<OrgContributorsProjectDistributionResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgContributorsProjectDistributionResponse>('/api/analytics/org-contributors-project-distribution', { params }).pipe(
      catchError(() => {
        return of({ projects: [] });
      })
    );
  }

  /**
   * Get monthly active maintainer trend for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org maintainers monthly response
   */
  public getOrgMaintainersMonthly(accountId: string, foundationSlug: string): Observable<OrgMaintainersMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgMaintainersMonthlyResponse>('/api/analytics/org-maintainers-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalMaintainers: 0 });
      })
    );
  }

  /**
   * Get top 5 project maintainer distribution for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org maintainers distribution response
   */
  public getOrgMaintainersDistribution(accountId: string, foundationSlug: string): Observable<OrgMaintainersDistributionResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgMaintainersDistributionResponse>('/api/analytics/org-maintainers-distribution', { params }).pipe(
      catchError(() => {
        return of({ projects: [] });
      })
    );
  }

  /**
   * Get key maintainer members for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org maintainers key members response
   */
  public getOrgMaintainersKeyMembers(accountId: string, foundationSlug: string): Observable<OrgMaintainersKeyMembersResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgMaintainersKeyMembersResponse>('/api/analytics/org-maintainers-key-members', { params }).pipe(
      catchError(() => {
        return of({ members: [] });
      })
    );
  }

  /**
   * Get monthly per-event-attendee counts for an organization within a foundation
   * @param accountId - Organization account ID
   * @param foundationSlug - Foundation slug to filter by
   * @returns Observable of org event attendees monthly response
   */
  public getOrgEventAttendeesMonthly(accountId: string, foundationSlug: string): Observable<OrgEventAttendeesMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgEventAttendeesMonthlyResponse>('/api/analytics/org-event-attendees-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalAttendees: 0 });
      })
    );
  }

  public getOrgEventSpeakersMonthly(accountId: string, foundationSlug: string): Observable<OrgEventSpeakersMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgEventSpeakersMonthlyResponse>('/api/analytics/org-event-speakers-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalSpeakers: 0 });
      })
    );
  }

  public getOrgCertifiedEmployeesMonthly(accountId: string, foundationSlug: string): Observable<OrgCertifiedEmployeesMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgCertifiedEmployeesMonthlyResponse>('/api/analytics/org-certified-employees-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalCertifiedEmployees: 0 });
      })
    );
  }

  public getOrgCertifiedEmployeesDistribution(accountId: string, foundationSlug: string): Observable<OrgCertifiedEmployeesDistributionResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgCertifiedEmployeesDistributionResponse>('/api/analytics/org-certified-employees-distribution', { params }).pipe(
      catchError(() => {
        return of({ programs: [] });
      })
    );
  }

  public getOrgTrainingEnrollmentsMonthly(accountId: string, foundationSlug: string): Observable<OrgTrainingEnrollmentsMonthlyResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgTrainingEnrollmentsMonthlyResponse>('/api/analytics/org-training-enrollments-monthly', { params }).pipe(
      catchError(() => {
        return of({ monthlyData: [], monthlyLabels: [], totalEnrollments: 0 });
      })
    );
  }

  public getOrgTrainingEnrollmentsDistribution(accountId: string, foundationSlug: string): Observable<OrgTrainingEnrollmentsDistributionResponse> {
    const params = { accountId, foundationSlug };
    return this.http.get<OrgTrainingEnrollmentsDistributionResponse>('/api/analytics/org-training-enrollments-distribution', { params }).pipe(
      catchError(() => {
        return of({ projects: [] });
      })
    );
  }

  /**
   * Get web activities summary grouped by domain category
   * @param foundationSlug - Foundation slug to filter by (e.g., 'tlf', 'cncf')
   * @returns Observable of web activities summary response
   */
  public getWebActivitiesSummary(foundationSlug: string): Observable<WebActivitiesSummaryResponse> {
    return this.http.get<WebActivitiesSummaryResponse>('/api/analytics/web-activities-summary', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalSessions: 0,
          totalPageViews: 0,
          domainGroups: [],
          dailyData: [],
          dailyLabels: [],
        });
      })
    );
  }

  /**
   * Get email click-through rate data
   * @param foundationName - Foundation name to filter by (e.g., 'The Linux Foundation')
   * @returns Observable of email CTR response
   */
  public getEmailCtr(foundationName: string): Observable<EmailCtrResponse> {
    return this.http.get<EmailCtrResponse>('/api/analytics/email-ctr', { params: { foundationName } }).pipe(
      catchError(() => {
        return of({
          currentCtr: 0,
          changePercentage: 0,
          trend: 'up' as const,
          monthlyData: [],
          monthlyLabels: [],
          campaignGroups: [],
          monthlySends: [],
          monthlyOpens: [],
        });
      })
    );
  }

  /**
   * Get social media metrics from Snowflake Platinum tables
   * Queries ANALYTICS.PLATINUM_LFX_ONE.SOCIAL_MEDIA_OVERVIEW and SOCIAL_MEDIA_PLATFORM_BREAKDOWN
   * @param foundationName - Foundation name used to filter metrics (e.g., 'The Linux Foundation')
   * @returns Social media response with followers, platforms, engagement, and trend data
   */
  public getSocialMedia(foundationName: string): Observable<SocialMediaResponse> {
    return this.http.get<SocialMediaResponse>('/api/analytics/social-media', { params: { foundationName } }).pipe(
      catchError(() => {
        return of({
          totalFollowers: 0,
          totalPlatforms: 0,
          changePercentage: 0,
          trend: 'up' as const,
          platforms: [],
          monthlyData: [],
        });
      })
    );
  }

  /**
   * Get paid social reach metrics
   * @param foundationName - Foundation name used to filter metrics (e.g., 'The Linux Foundation')
   * @returns Social reach response with ROAS, impressions, and monthly trends
   */
  public getSocialReach(foundationName: string): Observable<SocialReachResponse> {
    return this.http.get<SocialReachResponse>('/api/analytics/social-reach', { params: { foundationName } }).pipe(
      catchError(() => {
        return of({
          totalReach: 0,
          roas: 0,
          totalSpend: 0,
          totalRevenue: 0,
          changePercentage: 0,
          trend: 'up' as const,
          monthlyData: [],
          monthlyLabels: [],
          monthlyRoas: [],
          channelGroups: [],
        });
      })
    );
  }

  // North Star Metrics

  /**
   * Get member retention metrics from Snowflake North Star views
   */
  public getMemberRetention(foundationSlug: string): Observable<MemberRetentionResponse> {
    return this.http.get<MemberRetentionResponse>('/api/analytics/member-retention', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          renewalRate: 0,
          netRevenueRetention: 0,
          changePercentage: 0,
          trend: 'up' as const,
          target: 85,
          monthlyData: [],
        });
      })
    );
  }

  /**
   * Get member acquisition rate metrics from Snowflake North Star views
   */
  public getMemberAcquisition(foundationSlug: string): Observable<MemberAcquisitionResponse> {
    return this.http.get<MemberAcquisitionResponse>('/api/analytics/member-acquisition', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalMembers: 0,
          totalMembersMonthlyData: [],
          totalMembersMonthlyLabels: [],
          newMembersThisQuarter: 0,
          newMemberRevenue: 0,
          changePercentage: 0,
          trend: 'up' as const,
          quarterlyData: [],
        });
      })
    );
  }

  /**
   * Get engaged community size metrics from Snowflake North Star views
   */
  public getEngagedCommunity(foundationSlug: string): Observable<EngagedCommunitySizeResponse> {
    return this.http.get<EngagedCommunitySizeResponse>('/api/analytics/engaged-community', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          totalMembers: 0,
          changePercentage: 0,
          trend: 'up' as const,
          breakdown: {
            newsletterSubscribers: 0,
            communityMembers: 0,
            workingGroupMembers: 0,
            certifiedIndividuals: 0,
          },
          monthlyData: [],
        });
      })
    );
  }

  /**
   * Get flywheel conversion rate metrics from Snowflake North Star views
   */
  public getFlywheelConversion(foundationSlug: string): Observable<FlywheelConversionResponse> {
    return this.http.get<FlywheelConversionResponse>('/api/analytics/flywheel-conversion', { params: { foundationSlug } }).pipe(
      catchError(() => {
        return of({
          conversionRate: 0,
          changePercentage: 0,
          trend: 'up' as const,
          funnel: {
            eventAttendees: 0,
            convertedToNewsletter: 0,
            convertedToCommunity: 0,
            convertedToWorkingGroup: 0,
          },
          reengagement: {
            totalReengaged: 0,
            reengagementRate: 0,
            reengagementMomChange: 0,
            reengagedToNewsletter: 0,
            reengagedToCommunity: 0,
            reengagedToWorkingGroup: 0,
            reengagedToTraining: 0,
            reengagedToCode: 0,
            reengagedToWeb: 0,
          },
          monthlyData: [],
        });
      })
    );
  }

  /**
   * Get NPS summary for a foundation
   * @param foundationSlug - Foundation slug for Snowflake project resolution
   * @returns Observable of NPS summary response; degrades to zeros on error
   */
  public getNpsSummary(foundationSlug: string, range: string = 'YTD'): Observable<NpsSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<NpsSummaryResponse>('/api/analytics/nps-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          npsScore: 0,
          promoters: 0,
          passives: 0,
          detractors: 0,
          nonResponses: 0,
          responses: 0,
          lastUpdatedLabel: 'N/A',
        });
      })
    );
  }

  /**
   * Get participating organizations summary (membership counts + engagement breakdown)
   * @param foundationSlug - Foundation slug for Snowflake project_slug filter
   * @returns Observable of participating orgs summary response
   */
  public getParticipatingOrgsSummary(foundationSlug: string, range: string = 'YTD'): Observable<ParticipatingOrgsSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<ParticipatingOrgsSummaryResponse>('/api/analytics/participating-orgs-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          totalActiveMembers: 0,
          totalNewMembers: 0,
          highEngagement: 0,
          medEngagement: 0,
          lowEngagement: 0,
        });
      })
    );
  }

  /**
   * Get consolidated membership churn per tier summary
   * @param foundationSlug - Foundation slug for Snowflake project resolution
   * @param range - Reporting range (default 'YTD')
   * @returns Observable of churn summary; degrades to zeros on error
   */
  public getMembershipChurnPerTierSummary(foundationSlug: string, range: string = 'YTD'): Observable<MembershipChurnPerTierSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<MembershipChurnPerTierSummaryResponse>('/api/analytics/membership-churn-per-tier-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          range: 'YTD',
          comparisonAvailable: false,
          currentPeriod: { churnRatePct: 0, valueLost: 0, membersLost: 0 },
          previousYear: null,
          trend: null,
        });
      })
    );
  }

  /**
   * Get events summary for a foundation (total events, change, sponsorship vs goal)
   * @param foundationSlug - Foundation slug for Snowflake project resolution
   * @returns Observable of events summary; degrades to zeros on error
   */
  public getEventsSummary(foundationSlug: string, range: string = 'YTD'): Observable<EventsSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<EventsSummaryResponse>('/api/analytics/events-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          totalEvents: 0,
          upcomingEvents: 0,
          pastEvents: 0,
          eventChange: 0,
          eventCountDiff: 0,
          sponsorshipRevenue: 0,
          sponsorshipGoal: 0,
          sponsorshipProgressPct: 0,
        });
      })
    );
  }

  public getTrainingCertificationSummary(foundationSlug: string, range: string = 'YTD'): Observable<TrainingCertificationSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<TrainingCertificationSummaryResponse>('/api/analytics/training-certification-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          range: (range || 'YTD') as TrainingCertificationSummaryResponse['range'],
          enrollment: { instructorLed: 0, eLearning: 0, certExams: 0, edx: 0 },
          revenue: { instructorLed: 0, eLearning: 0, certExams: 0 },
        });
      })
    );
  }

  public getCodeContributionSummary(foundationSlug: string, range: string = 'YTD'): Observable<CodeContributionSummaryResponse> {
    const params: Record<string, string> = { foundationSlug };
    if (range && range !== 'YTD') {
      params['range'] = range;
    }
    return this.http.get<CodeContributionSummaryResponse>('/api/analytics/code-contribution-summary', { params }).pipe(
      catchError(() => {
        return of({
          dataAvailable: false,
          projectId: '',
          projectSlug: '',
          range: (range || 'YTD') as CodeContributionSummaryResponse['range'],
          totalContributors: 0,
          totalContributorsChange: 0,
          newContributors: 0,
          newContributorsChange: 0,
          committers: 0,
          maintainers: 0,
          reviewers: 0,
        });
      })
    );
  }

  public getOutstandingBalanceSummary(foundationSlug: string): Observable<OutstandingBalanceSummaryResponse> {
    const params = { foundationSlug };
    return this.http.get<OutstandingBalanceSummaryResponse>('/api/analytics/outstanding-balance-summary', { params }).pipe(
      catchError(() => {
        return of({
          projectId: '',
          totalOutstandingBalance: 0,
          totalMembersAtRisk: 0,
          primaryRiskLevel: null,
          primaryRiskAmount: 0,
          overdueBreakdown: {
            medium: { riskLevel: 'Medium' as const, overdueRangeLabel: '60-89' as const, outstandingBalance: 0, membersAtRisk: 0 },
            high: { riskLevel: 'High' as const, overdueRangeLabel: '90+' as const, outstandingBalance: 0, membersAtRisk: 0 },
          },
        });
      })
    );
  }
}
