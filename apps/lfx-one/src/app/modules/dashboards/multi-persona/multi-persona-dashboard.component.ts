// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { Router } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  BoardMemberDetectionExtra,
  CommitteeMemberDetectionExtra,
  DashboardSummaryPills,
  EnrichedPersonaProject,
  FoundationHealthScoreDistributionResponse,
  MultiFoundationSummaryResponse,
  PastMeeting,
  PendingActionItem,
  PerFoundationAnalytics,
  PersonaProjectRow,
  PersonaType,
  ProjectContext,
  Meeting,
} from '@lfx-one/shared/interfaces';
import { PERSONA_PRIORITY, ROLE_PRIORITY, VOTING_STATUS_PRIORITY } from '@lfx-one/shared/constants';
import { SurveyStatus } from '@lfx-one/shared/enums';
import { getActiveOccurrences, getSurveyDisplayStatus } from '@lfx-one/shared/utils';

import { AnalyticsService } from '@services/analytics.service';
import { LensService } from '@services/lens.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SurveyService } from '@services/survey.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { BehaviorSubject, catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';

import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { MyMeetingsComponent } from '../components/my-meetings/my-meetings.component';
import { PendingActionsComponent } from '../components/pending-actions/pending-actions.component';

@Component({
  selector: 'lfx-multi-persona-dashboard',
  imports: [SkeletonModule, MyMeetingsComponent, PendingActionsComponent, CardComponent, TableComponent],
  templateUrl: './multi-persona-dashboard.component.html',
  styleUrl: './multi-persona-dashboard.component.scss',
})
export class MultiPersonaDashboardComponent {
  private readonly personaService = inject(PersonaService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly surveyService = inject(SurveyService);
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly lensService = inject(LensService);
  private readonly router = inject(Router);

  private readonly refresh$ = new BehaviorSubject<void>(undefined);

  // All detected projects (foundations + projects)
  protected readonly allProjects: Signal<EnrichedPersonaProject[]> = computed(() => this.personaService.detectedProjects());

  // Only foundations (for analytics fetch)
  protected readonly userFoundations: Signal<EnrichedPersonaProject[]> = computed(() => this.allProjects().filter((p) => p.isFoundation));

  // Visibility flags
  protected readonly hasFoundations: Signal<boolean> = computed(() => this.allProjects().some((p) => p.isFoundation));
  protected readonly hasProjects: Signal<boolean> = computed(() => this.allProjects().some((p) => !p.isFoundation));
  protected readonly showTypeColumn: Signal<boolean> = computed(() => this.hasFoundations() && this.hasProjects());

  // Section title
  protected readonly sectionTitle: Signal<string> = computed(() => {
    if (this.hasFoundations() && this.hasProjects()) return 'My Foundations and Projects';
    if (this.hasFoundations()) return 'My Foundations';
    return 'My Projects';
  });

  protected readonly subtitleText: Signal<string> = this.initSubtitleText();
  protected readonly analyticsSummary: Signal<MultiFoundationSummaryResponse | null> = this.initAnalyticsSummary();
  protected readonly projectRows: Signal<PersonaProjectRow[]> = this.initProjectRows();
  // Independent loading signals so each pill renders as its source lands (no combineLatest gate).
  protected readonly openSurveysLoading = signal(true);
  protected readonly meetingsPillLoading = signal(true);
  private readonly openSurveysCount: Signal<number> = this.initOpenSurveysCount();
  private readonly meetingsThisWeek: Signal<{ completed: number; upcoming: number }> = this.initMeetingsThisWeek();
  protected readonly summaryPills: Signal<DashboardSummaryPills> = computed(() => ({
    openSurveys: this.openSurveysCount(),
    meetingsCompletedThisWeek: this.meetingsThisWeek().completed,
    meetingsUpcomingThisWeek: this.meetingsThisWeek().upcoming,
    itemsNeedReview: 0,
  }));
  protected readonly foundationCount: Signal<number> = computed(() => this.userFoundations().length);
  protected readonly projectCount: Signal<number> = computed(() => this.allProjects().length - this.userFoundations().length);
  protected readonly foundationRoleSummary: Signal<string> = computed(() => this.buildRoleSummary(this.userFoundations()));
  protected readonly projectRoleSummary: Signal<string> = computed(() => this.buildRoleSummary(this.allProjects().filter((p) => !p.isFoundation)));
  protected readonly totalMeetingsThisWeek: Signal<number> = computed(() => {
    const s = this.summaryPills();
    return s.meetingsCompletedThisWeek + s.meetingsUpcomingThisWeek;
  });
  protected readonly pendingActionsLoading = signal(true);
  protected readonly pendingActions: Signal<PendingActionItem[]> = this.initPendingActions();

  public constructor() {
    // Fetch enriched persona projects so role-group lists show project names instead of slugs.
    this.personaService.refreshEnrichedPersonas().subscribe();
  }

  public openRow(row: PersonaProjectRow): void {
    const context: ProjectContext = {
      uid: row.projectUid,
      name: row.projectName,
      slug: row.projectSlug,
    };
    if (row.type === 'foundation') {
      this.projectContextService.setFoundation(context);
      this.lensService.setLens('foundation');
      this.router.navigate(['/foundation/overview']);
    } else {
      this.projectContextService.setProject(context);
      this.lensService.setLens('project');
      this.router.navigate(['/project/overview']);
    }
  }

  public handleActionClick(): void {
    this.refresh$.next();
  }

  private initSubtitleText(): Signal<string> {
    return computed(() => {
      const personas = this.personaService.allPersonas();
      const roleLabels = personas.map((p) => {
        switch (p) {
          case 'executive-director':
            return 'executive director';
          case 'board-member':
            return 'board';
          case 'maintainer':
            return 'maintainer';
          case 'contributor':
            return 'contributor';
          default:
            return p;
        }
      });
      const label = roleLabels.join(' and ');

      if (this.hasFoundations() && this.hasProjects()) {
        return `Your ${label} activity across all projects and foundations.`;
      }
      if (this.hasFoundations()) {
        return `Your ${label} activity across ${this.userFoundations().length} foundations.`;
      }
      return `Your ${label} activity across ${this.allProjects().length} projects.`;
    });
  }

  private initAnalyticsSummary(): Signal<MultiFoundationSummaryResponse | null> {
    return toSignal(
      toObservable(this.userFoundations).pipe(
        filter((foundations) => foundations.length > 0),
        switchMap((foundations) => {
          const slugs = foundations.map((f) => f.projectSlug);
          return this.analyticsService.getMultiFoundationSummary(slugs).pipe(catchError(() => of(null)));
        })
      ),
      { initialValue: null }
    );
  }

  private initProjectRows(): Signal<PersonaProjectRow[]> {
    return computed(() => {
      const projects = this.allProjects();
      const analytics = this.analyticsSummary();

      const rows = projects.map((project) => {
        const isFoundation = project.isFoundation;
        const perFoundation = isFoundation ? analytics?.perFoundation[project.projectSlug] : null;

        return {
          projectUid: project.projectUid,
          projectSlug: project.projectSlug,
          projectName: project.projectName || project.projectSlug,
          logoUrl: project.logoUrl,
          type: isFoundation ? ('foundation' as const) : ('project' as const),
          subtitle: this.getRowSubtitle(project, perFoundation),
          role: this.getRowRole(project),
          healthStatus: isFoundation ? this.getHealthStatus(perFoundation?.healthScores) : null,
          healthDetail: isFoundation ? this.getHealthDetail(perFoundation?.healthScores) : null,
          votingStatus: this.getHighestVotingStatus(project),
        };
      });

      // Sort: foundations first, then by role priority, then alphabetically by name
      return rows.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'foundation' ? -1 : 1;
        }
        const aRoleIdx = ROLE_PRIORITY.indexOf(a.role);
        const bRoleIdx = ROLE_PRIORITY.indexOf(b.role);
        const roleCompare = (aRoleIdx === -1 ? 999 : aRoleIdx) - (bRoleIdx === -1 ? 999 : bRoleIdx);
        if (roleCompare !== 0) return roleCompare;
        return a.projectName.localeCompare(b.projectName);
      });
    });
  }

  private initOpenSurveysCount(): Signal<number> {
    return toSignal(
      this.surveyService.getMySurveys().pipe(
        map((surveys) => surveys.filter((s) => getSurveyDisplayStatus(s) === SurveyStatus.OPEN).length),
        catchError(() => of(0)),
        tap(() => this.openSurveysLoading.set(false))
      ),
      { initialValue: 0 }
    );
  }

  private initMeetingsThisWeek(): Signal<{ completed: number; upcoming: number }> {
    return toSignal(
      combineLatest([
        this.userService.getUserMeetings().pipe(catchError(() => of([] as Meeting[]))),
        this.userService.getUserPastMeetings().pipe(catchError(() => of([] as PastMeeting[]))),
      ]).pipe(
        map(([meetings, pastMeetings]) => ({
          upcoming: this.countUpcomingMeetingsThisWeek(meetings),
          completed: this.countCompletedMeetingsThisWeek(pastMeetings),
        })),
        tap(() => this.meetingsPillLoading.set(false))
      ),
      { initialValue: { completed: 0, upcoming: 0 } }
    );
  }

  private initPendingActions(): Signal<PendingActionItem[]> {
    return toSignal(
      this.refresh$.pipe(
        switchMap(() => {
          this.pendingActionsLoading.set(true);
          // Single unscoped request — the backend aggregates across all of the user's FGA grants.
          return this.projectService.getPendingActions().pipe(catchError(() => of([] as PendingActionItem[])));
        }),
        // Windowing (dismiss filtering + display cap) is owned by PendingActionsComponent.
        // Pass the raw aggregated list and let the child render the top 5 unhidden items.
        tap(() => this.pendingActionsLoading.set(false))
      ),
      { initialValue: [] }
    );
  }

  private getRowSubtitle(project: EnrichedPersonaProject, analytics: PerFoundationAnalytics | null | undefined): string {
    if (project.isFoundation) {
      const projects = analytics?.totalProjects ?? 0;
      const members = analytics?.totalMembers ?? 0;
      return `${projects} projects · ${members.toLocaleString()} members`;
    }
    // For sub-projects, show parent foundation name
    const parentFoundation = this.userFoundations().find((f) => f.projectUid === project.parentProjectUid);
    const parentName = parentFoundation?.projectName || '';
    return parentName;
  }

  private getRowRole(project: EnrichedPersonaProject): string {
    // For foundations, check board_member/committee_member detection extras
    if (project.isFoundation) {
      return this.getHighestRole(project);
    }
    // For projects, derive from persona type
    if (project.personas.includes('maintainer')) return 'Maintainer';
    if (project.personas.includes('contributor')) return 'Contributor';
    return this.getHighestRole(project);
  }

  private getHighestRole(project: EnrichedPersonaProject): string {
    const roles: string[] = [];
    for (const detection of project.detections) {
      if (detection.source === 'board_member') {
        const extra = detection.extra as BoardMemberDetectionExtra | undefined;
        if (extra?.role) {
          roles.push(this.normalizeRole(extra.role));
        }
      } else if (detection.source === 'committee_member') {
        const extra = detection.extra as CommitteeMemberDetectionExtra | undefined;
        if (extra?.role) {
          roles.push(this.normalizeRole(extra.role));
        }
      }
    }
    if (project.personas.includes('executive-director')) {
      roles.push('Executive Director');
    }
    if (roles.length === 0) return 'Group Member';
    return this.pickByPriority(roles, ROLE_PRIORITY) ?? roles[0];
  }

  private normalizeRole(role: string): string {
    return role === 'Member' ? 'Group Member' : role;
  }

  private getHighestVotingStatus(project: EnrichedPersonaProject): string | null {
    const statuses: string[] = [];
    for (const detection of project.detections) {
      if (detection.source === 'board_member') {
        const extra = detection.extra as BoardMemberDetectionExtra | undefined;
        if (extra?.voting_status) {
          statuses.push(extra.voting_status);
        }
      }
    }
    if (statuses.length === 0) return null;
    return this.pickByPriority(statuses, VOTING_STATUS_PRIORITY) ?? statuses[0];
  }

  private pickByPriority(values: string[], priority: readonly string[]): string | null {
    for (const p of priority) {
      if (values.some((v) => v.toLowerCase() === p.toLowerCase())) {
        return p;
      }
    }
    return null;
  }

  private getHealthStatus(scores?: FoundationHealthScoreDistributionResponse): 'on-track' | 'watch' | 'needs-attention' {
    if (!scores) return 'on-track';
    if (scores.critical + scores.unsteady > 0) return 'needs-attention';
    if (scores.stable > 0) return 'watch';
    return 'on-track';
  }

  private getHealthDetail(scores?: FoundationHealthScoreDistributionResponse): string {
    if (!scores) return 'On Track';
    const needsAttention = scores.critical + scores.unsteady;
    if (needsAttention > 0) return `${needsAttention} need attention`;
    if (scores.stable > 0) return `${scores.stable} watch`;
    return 'On Track';
  }

  private countUpcomingMeetingsThisWeek(meetings: Meeting[]): number {
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
    endOfWeek.setHours(0, 0, 0, 0);

    let count = 0;
    for (const meeting of meetings) {
      if (meeting.occurrences?.length > 0) {
        for (const occ of getActiveOccurrences(meeting.occurrences)) {
          const occDate = new Date(occ.start_time);
          if (occDate >= now && occDate < endOfWeek) {
            count++;
          }
        }
      } else {
        const meetingDate = new Date(meeting.start_time);
        if (meetingDate >= now && meetingDate < endOfWeek) {
          count++;
        }
      }
    }
    return count;
  }

  private countCompletedMeetingsThisWeek(pastMeetings: PastMeeting[]): number {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    let count = 0;
    for (const pm of pastMeetings) {
      const pmDate = new Date(pm.scheduled_start_time ?? pm.start_time);
      if (pmDate >= startOfWeek && pmDate < now) {
        count++;
      }
    }
    return count;
  }

  private buildRoleSummary(projects: EnrichedPersonaProject[]): string {
    const counts: Partial<Record<PersonaType, number>> = {};
    for (const p of projects) {
      for (const persona of p.personas) {
        counts[persona] = (counts[persona] ?? 0) + 1;
      }
    }
    const ROLE_LABELS: Record<PersonaType, string> = {
      'executive-director': 'Executive Director',
      'board-member': 'Board Member',
      maintainer: 'Maintainer',
      contributor: 'Contributor',
    };
    return PERSONA_PRIORITY.filter((r) => counts[r])
      .map((r) => `${ROLE_LABELS[r]} (${counts[r]})`)
      .join(', ');
  }
}
