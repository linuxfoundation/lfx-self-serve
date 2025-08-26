// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ChartComponent } from '@components/chart/chart.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { Committee, Meeting, Project, ProjectHealth, ProjectStats, RecentActivity, TableData } from '@lfx-pcc/shared/interfaces';
import { ActivityService } from '@services/activity.service';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { ChartData, ChartOptions } from 'chart.js';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, finalize, of, switchMap } from 'rxjs';

import { CommitteeFormComponent } from '../../committees/components/committee-form/committee-form.component';

@Component({
  selector: 'lfx-project',
  imports: [CardComponent, TableComponent, DatePipe, RouterModule, SkeletonModule, ButtonComponent, ChartComponent, MenuComponent, TooltipModule],
  templateUrl: './project.component.html',
  styleUrl: './project.component.scss',
})
export class ProjectComponent {
  public readonly activatedRoute = inject(ActivatedRoute);
  private readonly projectService = inject(ProjectService);
  private readonly committeeService = inject(CommitteeService);
  private readonly meetingService = inject(MeetingService);
  private readonly activityService = inject(ActivityService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);

  // Signals to hold data
  public allCommittees: Signal<Committee[]> = signal([]);
  public allMeetings: Signal<Meeting[]> = signal([]);
  public committeesLoading: WritableSignal<boolean> = signal(true);
  public meetingsLoading: WritableSignal<boolean> = signal(true);

  // Load project data based on slug from URL
  public project: Signal<Project | null> = this.projectService.project;

  // Computed signals for filtered data
  public readonly recentCommittees: Signal<Committee[]>;
  public readonly upcomingMeetings: Signal<Meeting[]>;
  public readonly meetingTableData: Signal<TableData[]>;
  public readonly committeeTableData: Signal<TableData[]>;
  public readonly mailingListTableData: Signal<TableData[]>;

  // Project statistics computed signals
  public readonly projectStats: Signal<ProjectStats>;

  // Recent activity feed from API
  public readonly recentActivity: Signal<RecentActivity[]> = signal([]);

  // Project health indicators
  public readonly projectHealth: Signal<ProjectHealth>;

  // Chart data for activity score
  public readonly activityChartData: Signal<ChartData>;
  public readonly activityChartOptions: Signal<ChartOptions>;

  // Menu items for quick actions
  public readonly quickActionMenuItems: MenuItem[] = this.initializeQuickActionMenuItems();

  // Meeting participation rate doughnut chart data
  public readonly meetingParticipationChartData: Signal<ChartData>;
  public readonly meetingParticipationChartOptions: Signal<ChartOptions>;

  // Line chart data for meeting frequency
  public readonly meetingFrequencyChartData: Signal<ChartData>;
  public readonly meetingFrequencyChartOptions: Signal<ChartOptions>;

  // Committee utilization doughnut chart data
  public readonly committeeUtilizationChartData: Signal<ChartData>;
  public readonly committeeUtilizationChartOptions: Signal<ChartOptions>;

  public constructor() {
    // Initialize data signals
    this.allCommittees = this.initializeAllCommittees();
    this.allMeetings = this.initializeAllMeetings();
    this.recentActivity = this.initializeRecentActivity();

    // Initialize computed signals
    this.recentCommittees = this.initializeRecentCommittees();
    this.upcomingMeetings = this.initializeUpcomingMeetings();
    this.meetingTableData = this.initializeMeetingTableData();
    this.committeeTableData = this.initializeCommitteeTableData();
    this.mailingListTableData = this.initializeMailingListTableData();
    this.projectStats = this.initializeProjectStats();
    this.projectHealth = this.initializeProjectHealth();
    this.activityChartData = this.initializeActivityChartData();
    this.activityChartOptions = this.initializeActivityChartOptions();
    this.meetingParticipationChartData = this.initializeMeetingParticipationChartData();
    this.meetingParticipationChartOptions = this.initializeMeetingParticipationChartOptions();
    this.meetingFrequencyChartData = this.initializeMeetingFrequencyChartData();
    this.meetingFrequencyChartOptions = this.initializeMeetingFrequencyChartOptions();
    this.committeeUtilizationChartData = this.initializeCommitteeUtilizationChartData();
    this.committeeUtilizationChartOptions = this.initializeCommitteeUtilizationChartOptions();
  }

  public openCreateDialog(): void {
    const projectId = this.project()?.uid;
    if (!projectId) return;

    this.dialogService.open(CommitteeFormComponent, {
      header: 'Create Committee',
      width: '600px',
      contentStyle: { overflow: 'auto' },
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        projectId: projectId,
      },
    });
  }

  // Private initialization methods
  private initializeAllCommittees(): Signal<Committee[]> {
    return toSignal(
      this.projectService.project$.pipe(
        switchMap((project) => {
          if (!project?.uid) {
            this.committeesLoading.set(false);
            return of([]);
          }
          return this.committeeService.getCommitteesByProject(project.uid).pipe(
            catchError((error) => {
              console.error('Error loading committees:', error);
              return of([]);
            }),
            finalize(() => {
              this.committeesLoading.set(false);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeAllMeetings(): Signal<Meeting[]> {
    return toSignal(
      this.projectService.project$.pipe(
        switchMap((project) => {
          if (!project?.uid) {
            this.meetingsLoading.set(false);
            return of([]);
          }
          return this.meetingService.getMeetingsByProject(project.uid).pipe(
            catchError((error) => {
              console.error('Error loading meetings:', error);
              return of([]);
            }),
            finalize(() => {
              this.meetingsLoading.set(false);
            })
          );
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeRecentActivity(): Signal<RecentActivity[]> {
    return toSignal(
      this.projectService.project$.pipe(
        switchMap((project) => {
          if (!project?.slug) {
            return of([]);
          }
          return this.activityService.getRecentActivitiesByProject(project.uid, 5).pipe(
            catchError((error) => {
              console.error('Error loading recent activities:', error);
              return of([]);
            })
          );
        })
      ),
      {
        initialValue: [],
      }
    );
  }

  private initializeRecentCommittees(): Signal<Committee[]> {
    return computed(() => {
      return [...this.allCommittees()]
        .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
        .slice(0, 3);
    });
  }

  private initializeUpcomingMeetings(): Signal<Meeting[]> {
    return computed(() => {
      const now = new Date();
      return [...this.allMeetings()]
        .filter((meeting) => meeting.start_time && new Date(meeting.start_time) >= now)
        .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
        .slice(0, 3);
    });
  }

  private initializeMeetingTableData(): Signal<TableData[]> {
    return computed(() => {
      const project = this.project();
      const meetings = this.upcomingMeetings();

      if (!project) {
        return [];
      }

      return meetings.map((meeting) => ({
        id: meeting.uid,
        title: meeting.title || meeting.meeting_type || 'Untitled Meeting',
        url: `/project/${project.slug}/meetings`,
        status: 'Upcoming',
        date: meeting.start_time,
      }));
    });
  }

  private initializeCommitteeTableData(): Signal<TableData[]> {
    return computed(() => {
      const project = this.project();
      const committees = this.recentCommittees();

      if (!project) {
        return [];
      }

      return committees.map((committee) => ({
        id: committee.uid,
        title: committee.name,
        url: `/project/${project.slug}/committees/${committee.uid}`,
        status: 'Active',
        date: committee.updated_at || committee.created_at,
      }));
    });
  }

  private initializeMailingListTableData(): Signal<TableData[]> {
    return signal<TableData[]>([
      {
        id: 1,
        title: 'board',
        url: 'mailing-lists',
        status: 'Upcoming',
        date: '2025-07-10T10:32:00Z',
      },
      {
        id: 2,
        title: 'gsoc',
        url: 'mailing-lists',
        status: 'Upcoming',
        date: '2025-07-10T10:32:00Z',
      },
      {
        id: 3,
        title: 'budget',
        url: 'mailing-lists',
        status: 'Upcoming',
        date: '2025-07-10T10:32:00Z',
      },
    ]);
  }

  private initializeProjectStats(): Signal<ProjectStats> {
    return computed(() => {
      const committees = this.allCommittees();
      const meetings = this.allMeetings();
      const now = new Date();

      // Calculate total members from all committees
      const totalMembers = committees.reduce((sum, committee) => sum + (committee.total_members || 0), 0);

      // Calculate meeting statistics
      const upcomingMeetingsCount = meetings.filter((m) => m.start_time && new Date(m.start_time) >= now).length;
      const publicMeetings = meetings.filter((m) => m.visibility === 'public').length;
      const privateMeetings = meetings.filter((m) => m.visibility === 'private').length;

      return {
        totalMembers,
        totalCommittees: committees.length,
        totalMeetings: meetings.length,
        upcomingMeetings: upcomingMeetingsCount,
        publicMeetings,
        privateMeetings,
      };
    });
  }

  private initializeProjectHealth(): Signal<ProjectHealth> {
    return computed(() => {
      const committees = this.allCommittees();
      const meetings = this.allMeetings();
      const stats = this.projectStats();

      // Calculate various health metrics
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Recent activity count (last 30 days)
      const recentCommitteeUpdates = committees.filter((c) => c.updated_at && new Date(c.updated_at) >= thirtyDaysAgo).length;

      const recentMeetings = meetings.filter((m) => m.start_time && new Date(m.start_time) >= thirtyDaysAgo && new Date(m.start_time) <= now).length;

      // Activity score (0-100)
      const activityScore = Math.min(100, (recentCommitteeUpdates + recentMeetings) * 10);

      // Engagement metrics
      const avgMembersPerCommittee = committees.length > 0 ? Math.round(stats.totalMembers / committees.length) : 0;

      // Meeting frequency (meetings per month)
      const meetingFrequency = recentMeetings;

      // Committee utilization (committees with recent updates)
      const activeCommittees = recentCommitteeUpdates;
      const committeeUtilization = committees.length > 0 ? Math.round((activeCommittees / committees.length) * 100) : 0;

      return {
        activityScore,
        avgMembersPerCommittee,
        meetingFrequency,
        committeeUtilization,
        recentCommitteeUpdates,
        recentMeetings,
      };
    });
  }

  private initializeActivityChartData(): Signal<ChartData> {
    return computed(() => {
      const score = this.projectHealth().activityScore;
      const remaining = 100 - score;

      return {
        labels: ['Activity', 'Remaining'],
        datasets: [
          {
            data: [score, remaining],
            backgroundColor: ['#0ea5e9', '#e5e7eb'],
            borderWidth: 0,
          },
        ],
      };
    });
  }

  private initializeActivityChartOptions(): Signal<ChartOptions> {
    return computed(() => ({
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
      },
      maintainAspectRatio: false,
      cutout: '70%',
    }));
  }

  private initializeMeetingParticipationChartData(): Signal<ChartData> {
    return computed(() => {
      const meetings = this.allMeetings();

      // Filter meetings that have a start time (scheduled meetings)
      const scheduledMeetings = meetings.filter((m) => m.start_time);

      // Count meetings that were completed (meeting end time has passed)
      const now = new Date();
      const completedMeetings = scheduledMeetings.filter((m) => {
        if (m.start_time && m.duration) {
          const endTime = new Date(new Date(m.start_time).getTime() + m.duration * 60 * 1000);
          return endTime < now;
        }
        return false;
      });

      const participationRate = scheduledMeetings.length > 0 ? Math.round((completedMeetings.length / scheduledMeetings.length) * 100) : 0;

      const remaining = 100 - participationRate;

      // Determine color based on participation rate
      let participationColor = '#ef4444'; // Red for < 60%
      if (participationRate >= 80) {
        participationColor = '#10b981'; // Green for >= 80%
      } else if (participationRate >= 60) {
        participationColor = '#f59e0b'; // Yellow for 60-79%
      }

      return {
        labels: ['Completed', 'Incomplete'],
        datasets: [
          {
            data: [participationRate, remaining],
            backgroundColor: [participationColor, '#e5e7eb'],
            borderWidth: 0,
          },
        ],
      };
    });
  }

  private initializeMeetingParticipationChartOptions(): Signal<ChartOptions> {
    return computed(() => ({
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
      },
      maintainAspectRatio: false,
      cutout: '70%',
    }));
  }

  private initializeMeetingFrequencyChartData(): Signal<ChartData> {
    return computed(() => {
      const meetings = this.allMeetings();
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Create a map of dates to meeting counts
      const dateMap = new Map<string, number>();

      // Initialize all dates with 0
      for (let i = 0; i < 30; i++) {
        const date = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        dateMap.set(dateStr, 0);
      }

      // Count meetings per day
      meetings.forEach((meeting) => {
        if (meeting.start_time) {
          const meetingDate = new Date(meeting.start_time);
          if (meetingDate >= thirtyDaysAgo && meetingDate <= now) {
            const dateStr = meetingDate.toISOString().split('T')[0];
            dateMap.set(dateStr, (dateMap.get(dateStr) || 0) + 1);
          }
        }
      });

      const sortedDates = Array.from(dateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      return {
        labels: sortedDates.map(([date]) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [
          {
            label: 'Meetings',
            data: sortedDates.map(([, count]) => count),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.3,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 0,
          },
        ],
      };
    });
  }

  private initializeMeetingFrequencyChartOptions(): Signal<ChartOptions> {
    return computed(() => ({
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: true,
        },
      },
      scales: {
        x: {
          display: false,
        },
        y: {
          display: false,
        },
      },
      maintainAspectRatio: false,
    }));
  }

  private initializeCommitteeUtilizationChartData(): Signal<ChartData> {
    return computed(() => {
      const utilization = this.projectHealth().committeeUtilization;
      const remaining = 100 - utilization;

      // Determine color based on utilization rate
      let utilizationColor = '#ef4444'; // Red for < 40%
      if (utilization >= 70) {
        utilizationColor = '#10b981'; // Green for >= 70%
      } else if (utilization >= 40) {
        utilizationColor = '#f59e0b'; // Yellow for 40-69%
      }

      return {
        labels: ['Active', 'Inactive'],
        datasets: [
          {
            data: [utilization, remaining],
            backgroundColor: [utilizationColor, '#e5e7eb'],
            borderWidth: 0,
          },
        ],
      };
    });
  }

  private initializeCommitteeUtilizationChartOptions(): Signal<ChartOptions> {
    return computed(() => ({
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          enabled: false,
        },
      },
      maintainAspectRatio: false,
      cutout: '70%',
    }));
  }

  private initializeQuickActionMenuItems(): MenuItem[] {
    return [
      {
        label: 'Create Meeting',
        icon: 'fa-light fa-calendar-plus text-sm',
        routerLink: ['meetings/create'],
      },
      {
        label: 'Create Committee',
        icon: 'fa-light fa-people-group text-sm',
        command: () => this.openCreateDialog(),
      },
      {
        label: 'View All Committees',
        icon: 'fa-light fa-list text-sm',
        routerLink: ['committees'],
      },
      {
        label: 'View Calendar',
        icon: 'fa-light fa-calendar text-sm',
        routerLink: ['meetings'],
      },
    ];
  }
}
