// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, PLATFORM_ID, signal } from '@angular/core';
import {
  HEALTH_METRICS_BOARD_MEETING_DEFAULT_SUMMARY,
  HEALTH_METRICS_BOARD_MEETING_JOB_TITLE_MAX_LENGTH,
  HEALTH_METRICS_BOARD_MEETING_LOW_ATTENDANCE_THRESHOLD,
} from '@lfx-one/shared/constants';
import { parseLocalDateString } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { initializeRangeDataFetching } from '@shared/utils/health-metrics-data.util';
import { SkeletonModule } from 'primeng/skeleton';

import { environment } from '@environments/environment';

import type {
  BoardMeetingColumnHeader,
  BoardMeetingDisplayRow,
  BoardMeetingInviteeRow,
  BoardMeetingParticipationSummaryResponse,
  BoardMeetingSortField,
  BoardMeetingSortOrder,
  HealthMetricsRange,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-board-meeting-card',
  standalone: true,
  imports: [SkeletonModule],
  templateUrl: './board-meeting-card.component.html',
  styleUrl: './board-meeting-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardMeetingCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  public readonly range = input<HealthMetricsRange>('YTD');

  protected readonly pccUrl = environment.urls.pcc;

  protected readonly loading = signal(true);
  protected readonly summaryData = signal<BoardMeetingParticipationSummaryResponse>(HEALTH_METRICS_BOARD_MEETING_DEFAULT_SUMMARY);

  protected readonly sortField = signal<BoardMeetingSortField>('lastAttended');
  protected readonly sortOrder = signal<BoardMeetingSortOrder>(-1);

  protected readonly projectId = computed(() => this.summaryData().projectId);
  protected readonly hasData = computed(() => this.summaryData().dataAvailable);
  protected readonly hasInvitees = computed(() => this.summaryData().invitees.length > 0);

  protected readonly addPastMeetingUrl = computed(() => {
    const id = this.projectId();
    if (!id) return '';
    return `${this.pccUrl}/project/${id}/collaboration/meetings/manage-meeting?isPast=true`;
  });

  protected readonly formattedAvgAttendance = computed(() => {
    return Math.round(this.summaryData().avgMeetingAttendance * 100);
  });

  protected readonly showTotalMeetingsChange = computed(() => {
    const change = this.summaryData().totalMeetingsChange;
    return change !== null && change !== 0;
  });

  protected readonly showAvgAttendanceChange = computed(() => {
    const change = this.summaryData().avgMeetingAttendanceChange;
    return change !== null && change !== 0;
  });

  protected readonly formattedTotalMeetingsChange = computed(() => {
    const change = this.summaryData().totalMeetingsChange ?? 0;
    const pct = Math.abs(change * 100).toFixed(0);
    return `${change < 0 ? '↓' : '↑'} ${pct}%`;
  });

  protected readonly formattedAvgAttendanceChange = computed(() => {
    const change = this.summaryData().avgMeetingAttendanceChange ?? 0;
    const pct = Math.abs(change * 100).toFixed(0);
    return `${change < 0 ? '↓' : '↑'} ${pct}%`;
  });

  protected readonly totalMeetingsChangeIsNegative = computed(() => {
    const change = this.summaryData().totalMeetingsChange ?? 0;
    return change < 0;
  });

  protected readonly avgAttendanceChangeIsNegative = computed(() => {
    const change = this.summaryData().avgMeetingAttendanceChange ?? 0;
    return change < 0;
  });

  private static readonly columnDefs: { field: BoardMeetingSortField; label: string }[] = [
    { field: 'inviteeFullName', label: 'Name' },
    { field: 'organizationName', label: 'Organization' },
    { field: 'attendancePercent', label: 'Attended (%)' },
    { field: 'lastAttended', label: 'Last Attended' },
  ];

  protected readonly columnHeaders = computed<BoardMeetingColumnHeader[]>(() => {
    const activeField = this.sortField();
    const activeOrder = this.sortOrder();
    return BoardMeetingCardComponent.columnDefs.map(({ field, label }) => {
      const isActive = activeField === field;
      let ariaSort: 'ascending' | 'descending' | 'none' = 'none';
      let iconClass = 'fa-solid text-xs text-gray-400 fa-sort';

      if (isActive) {
        ariaSort = activeOrder === 1 ? 'ascending' : 'descending';
        iconClass = `fa-solid text-xs text-gray-400 ${activeOrder === 1 ? 'fa-sort-up' : 'fa-sort-down'}`;
      }

      return { field, label, ariaSort, iconClass };
    });
  });

  protected readonly displayRows = computed<BoardMeetingDisplayRow[]>(() => {
    const rows = this.summaryData().invitees;
    const field = this.sortField();
    const order = this.sortOrder();
    const id = this.projectId();

    if (rows.length === 0) return [];

    const sorted = [...rows];
    sorted.sort((a, b) => BoardMeetingCardComponent.compareRows(a, b, field, order));

    return sorted.map((row) => ({
      displayName: BoardMeetingCardComponent.toTitleCase(row.inviteeFullName),
      displayJobTitle: BoardMeetingCardComponent.formatJobTitle(row.inviteeJobTitle),
      organizationName: row.organizationName,
      organizationUrl: id && row.organizationId ? `${this.pccUrl}/project/${id}/reports/health-metrics/members/${row.organizationId}` : '',
      attendanceLabel: `${row.meetingsAttended}/${row.meetingsInvited} (${Math.round(row.attendancePercent * 100)}%)`,
      isLowAttendance: row.attendancePercent < HEALTH_METRICS_BOARD_MEETING_LOW_ATTENDANCE_THRESHOLD,
      lastAttendedLabel: BoardMeetingCardComponent.formatLastAttended(row.lastAttended),
    }));
  });

  public constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initializeDataFetching();
    }
  }

  protected onSort(field: BoardMeetingSortField): void {
    if (this.sortField() === field) {
      this.sortOrder.update((o) => (o === 1 ? -1 : 1));
      return;
    }
    this.sortField.set(field);
    this.sortOrder.set(field === 'lastAttended' ? -1 : 1);
  }

  private static toTitleCase(name: string): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/\b[a-z]/g, (char) => char.toUpperCase())
      .replace(/(['-])([a-z])/g, (_match, separator, char) => `${separator}${char.toUpperCase()}`);
  }

  private static formatJobTitle(jobTitle: string | null): string | null {
    if (!jobTitle || jobTitle === 'Unavailable') return null;
    if (jobTitle.length > HEALTH_METRICS_BOARD_MEETING_JOB_TITLE_MAX_LENGTH) {
      return `${jobTitle.slice(0, HEALTH_METRICS_BOARD_MEETING_JOB_TITLE_MAX_LENGTH).trimEnd()}…`;
    }
    return jobTitle;
  }

  private static formatLastAttended(lastAttended: string | null): string {
    if (!lastAttended) return '–';
    try {
      const date = parseLocalDateString(lastAttended);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return '–';
    }
  }

  private static compareRows(a: BoardMeetingInviteeRow, b: BoardMeetingInviteeRow, field: BoardMeetingSortField, order: BoardMeetingSortOrder): number {
    if (field === 'lastAttended') {
      const aTime = BoardMeetingCardComponent.parseLastAttendedTime(a.lastAttended);
      const bTime = BoardMeetingCardComponent.parseLastAttendedTime(b.lastAttended);
      if (aTime === null && bTime === null) return 0;
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return (aTime - bTime) * order;
    }
    if (field === 'attendancePercent') {
      return (a.attendancePercent - b.attendancePercent) * order;
    }
    const aStr = (a[field] ?? '').toString().toLowerCase();
    const bStr = (b[field] ?? '').toString().toLowerCase();
    return aStr.localeCompare(bStr) * order;
  }

  private static parseLastAttendedTime(lastAttended: string | null): number | null {
    if (!lastAttended) return null;
    try {
      return parseLocalDateString(lastAttended).getTime();
    } catch {
      return null;
    }
  }

  private initializeDataFetching(): void {
    initializeRangeDataFetching({
      projectContextService: this.projectContextService,
      range: this.range,
      loading: this.loading,
      data: this.summaryData,
      defaultValue: HEALTH_METRICS_BOARD_MEETING_DEFAULT_SUMMARY,
      fetchFn: (slug, range) => this.analyticsService.getBoardMeetingParticipationSummary(slug, range),
      destroyRef: this.destroyRef,
    });
  }
}
