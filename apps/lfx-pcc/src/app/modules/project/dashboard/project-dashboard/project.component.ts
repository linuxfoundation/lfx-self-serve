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
import { Committee, Meeting, Project, RecentActivity } from '@lfx-pcc/shared/interfaces';
import { ActivityService } from '@services/activity.service';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { finalize } from 'rxjs';

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
  public readonly recentCommittees = computed(() => {
    return this.allCommittees()
      .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
      .slice(0, 3);
  });

  public readonly upcomingMeetings = computed(() => {
    const now = new Date();
    return this.allMeetings()
      .filter((meeting) => meeting.start_time && new Date(meeting.start_time) >= now)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
      .slice(0, 3);
  });

  public readonly meetingTableData: Signal<any[]> = computed(() => {
    return this.upcomingMeetings().map((meeting) => ({
      id: meeting.id,
      title: meeting.topic || meeting.meeting_type || 'Untitled Meeting',
      url: `/project/${this.project()?.slug}/meetings`,
      status: 'Upcoming',
      date: meeting.start_time,
    }));
  });

  public readonly committeeTableData: Signal<any[]> = computed(() => {
    return this.recentCommittees().map((committee) => ({
      id: committee.id,
      title: committee.name,
      url: `/project/${this.project()?.slug}/committees/${committee.id}`,
      status: 'Active',
      date: committee.updated_at || committee.created_at,
    }));
  });

  public readonly mailingListTableData: Signal<any[]> = signal([
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

  // Project statistics computed signals
  public readonly projectStats = computed(() => {
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

  // Recent activity feed from API
  public readonly recentActivity: Signal<RecentActivity[]> = signal([]);

  // Project health indicators
  public readonly projectHealth = computed(() => {
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

  // Chart data for activity score
  public readonly activityChartData = computed(() => {
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

  public readonly activityChartOptions = computed(() => ({
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

  // Menu items for quick actions
  public readonly quickActionMenuItems: MenuItem[] = [
    {
      label: 'Schedule Meeting',
      icon: 'fa-light fa-calendar-plus text-sm',
      routerLink: ['meetings'],
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

  // Meeting participation rate doughnut chart data
  public readonly meetingParticipationChartData = computed(() => {
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

  public readonly meetingParticipationChartOptions = computed(() => ({
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

  // Line chart data for meeting frequency
  public readonly meetingFrequencyChartData = computed(() => {
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

  public readonly meetingFrequencyChartOptions = computed(() => ({
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

  // Committee utilization doughnut chart data
  public readonly committeeUtilizationChartData = computed(() => {
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

  public readonly committeeUtilizationChartOptions = computed(() => ({
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

  public constructor() {
    // Fetch all committees
    this.allCommittees = toSignal(
      this.committeeService.getCommitteesByProject(this.project()?.id || '').pipe(
        finalize(() => {
          this.committeesLoading.set(false);
        })
      ),
      { initialValue: [] }
    );

    // Fetch all meetings
    this.allMeetings = toSignal(
      this.meetingService.getMeetingsByProject(this.project()?.id || '').pipe(
        finalize(() => {
          this.meetingsLoading.set(false);
        })
      ),
      { initialValue: [] }
    );

    // Fetch recent activity
    this.recentActivity = toSignal(this.activityService.getRecentActivitiesByProject(this.project()?.slug || '', 5), { initialValue: [] });
  }

  public openCreateDialog(): void {
    const projectId = this.project()?.id;
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
}
