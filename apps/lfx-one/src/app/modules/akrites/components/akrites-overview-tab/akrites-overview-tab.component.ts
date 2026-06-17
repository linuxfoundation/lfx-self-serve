// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe, TitleCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AkritesActivityResponse, AkritesActivityRow, AkritesFilterState, AkritesMetrics } from '@lfx-one/shared/interfaces';
import { catchError, of } from 'rxjs';
import { AkritesService } from '@shared/services/akrites.service';
import { formatActivityType } from '../../akrites.utils';

export interface AkritesActivityDayGroup {
  label: string;
  rows: AkritesActivityRow[];
}

@Component({
  selector: 'lfx-akrites-overview-tab',
  imports: [DecimalPipe, TitleCasePipe],
  templateUrl: './akrites-overview-tab.component.html',
})
export class AkritesOverviewTabComponent implements OnInit {
  private readonly akritesService = inject(AkritesService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly metrics = input<AkritesMetrics | undefined>(undefined);
  public readonly metricsLoading = input<boolean>(false);

  public readonly navigateToPackages = output<Partial<AkritesFilterState>>();

  protected readonly activityLoading = signal(true);
  protected readonly activityError = signal(false);
  protected readonly activityRows = signal<AkritesActivityRow[]>([]);

  protected readonly dayGroups = computed<AkritesActivityDayGroup[]>(() => this.groupByDay(this.activityRows()));

  protected readonly coveragePercent = computed(() => this.metrics()?.coveragePercent ?? 0);
  protected readonly criticalCoverage = computed(() => {
    const m = this.metrics();
    if (!m || !m.criticalPackages) return 0;
    const covered = m.criticalPackages - m.unassignedCritical;
    return Math.round((covered / m.criticalPackages) * 100);
  });

  public ngOnInit(): void {
    this.loadActivity();
  }

  protected onKpiClick(filter: Partial<AkritesFilterState>): void {
    this.navigateToPackages.emit(filter);
  }

  protected formatActivityLabel(type: string): string {
    return formatActivityType(type);
  }

  protected getActivityIcon(type: string): string {
    const icons: Record<string, string> = {
      escalation: 'fa-arrow-up',
      state_changed: 'fa-arrows-rotate',
      steward_assigned: 'fa-user-plus',
      steward_removed: 'fa-user-minus',
      stewardship_opened: 'fa-folder-open',
      package_synced: 'fa-rotate',
      advisory_detected: 'fa-shield-exclamation',
      advisory_resolved: 'fa-shield-check',
      status_inactive: 'fa-circle-pause',
      quarterly_update: 'fa-calendar-check',
      remediation_logged: 'fa-clipboard-check',
      assessment_started: 'fa-magnifying-glass',
      blocker_resolved: 'fa-circle-check',
      reactivated: 'fa-play',
    };
    return icons[type] ?? 'fa-circle-dot';
  }

  protected getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      escalated: 'bg-red-500',
      blocked: 'bg-red-400',
      needs_attention: 'bg-amber-500',
      active: 'bg-emerald-500',
      assessing: 'bg-blue-400',
      open: 'bg-blue-300',
      unassigned: 'bg-gray-300',
      inactive: 'bg-gray-400',
    };
    return colors[status] ?? 'bg-gray-300';
  }

  protected formatRelativeTime(isoDate: string): string {
    const ms = Date.now() - new Date(isoDate).getTime();
    if (Number.isNaN(ms)) return '';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(ms / 86_400_000);
    if (days < 60) return `${days}d ago`;
    return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private loadActivity(): void {
    this.akritesService
      .getActivityFeed(1, 50)
      .pipe(
        catchError(() => {
          this.activityError.set(true);
          return of<AkritesActivityResponse>({ rows: [], total: 0, page: 1, pageSize: 50 });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((res) => {
        this.activityRows.set(res.rows ?? []);
        this.activityLoading.set(false);
      });
  }

  private groupByDay(rows: AkritesActivityRow[]): AkritesActivityDayGroup[] {
    const groups = new Map<string, AkritesActivityRow[]>();
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    for (const row of rows) {
      const d = new Date(row.createdAt);
      let label: string;
      if (this.isSameDay(d, today)) {
        label = 'Today';
      } else if (this.isSameDay(d, yesterday)) {
        label = 'Yesterday';
      } else {
        label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(row);
    }

    return Array.from(groups.entries()).map(([label, groupRows]) => ({ label, rows: groupRows }));
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
}
