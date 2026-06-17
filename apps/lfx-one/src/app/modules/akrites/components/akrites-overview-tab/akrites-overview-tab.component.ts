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
  isToday: boolean;
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
  public readonly openPackageDrawer = output<string>(); // emits packagePurl

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

  protected onActivityRowClick(row: AkritesActivityRow): void {
    this.openPackageDrawer.emit(row.packagePurl);
  }

  protected onActionButtonClick(row: AkritesActivityRow, variant: 'default' | 'blue' | 'red'): void {
    if (variant === 'red') {
      // Escalation resolve — open drawer; escalate action is in the drawer
      this.openPackageDrawer.emit(row.packagePurl);
    } else if (variant === 'blue') {
      // Assign steward — open drawer
      this.openPackageDrawer.emit(row.packagePurl);
    } else {
      this.openPackageDrawer.emit(row.packagePurl);
    }
  }

  protected formatActivityLabel(type: string): string {
    return formatActivityType(type);
  }

  protected formatStatus(status: string): string {
    return status.replace(/_/g, ' ');
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

  protected getAccentStyle(status: string): string {
    const accentStatuses = ['open', 'escalated', 'needs_attention', 'blocked'];
    if (!accentStatuses.includes(status)) return '';
    return `box-shadow: inset 3px 0 0 ${this.getStatusHex(status)}`;
  }

  protected getStatusDotStyle(status: string): string {
    const outline = ['inactive', 'blocked'];
    const color = this.getStatusHex(status);
    return outline.includes(status) ? `background:#fff;border:1.5px solid ${color}` : `background:${color}`;
  }

  protected getStatusLabelStyle(status: string): string {
    return `color:${this.getStatusHex(status)}`;
  }

  protected getActivityAction(type: string): { label: string; variant: 'default' | 'blue' | 'red' } | null {
    const actions: Record<string, { label: string; variant: 'default' | 'blue' | 'red' }> = {
      escalation: { label: 'Resolve', variant: 'red' },
      steward_removed: { label: 'Assign steward', variant: 'blue' },
      stewardship_opened: { label: 'Assign steward', variant: 'blue' },
      advisory_detected: { label: 'Triage advisory', variant: 'default' },
      quarterly_update: { label: 'View update', variant: 'default' },
      remediation_logged: { label: 'Review progress', variant: 'default' },
      assessment_started: { label: 'Spot-check', variant: 'default' },
      status_inactive: { label: 'Reassign', variant: 'blue' },
    };
    return actions[type] ?? null;
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

  private getStatusHex(status: string): string {
    const colors: Record<string, string> = {
      unassigned: '#62748e',
      open: '#009aff',
      assessing: '#7c3aed',
      active: '#22c55e',
      needs_attention: '#f97316',
      escalated: '#e5484d',
      blocked: '#e5484d',
      inactive: '#90a1b9',
    };
    return colors[status] ?? '#62748e';
  }

  private groupByDay(rows: AkritesActivityRow[]): AkritesActivityDayGroup[] {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const dateOpts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };

    const groups = new Map<string, { rows: AkritesActivityRow[]; isToday: boolean }>();
    const order: string[] = [];

    for (const row of rows) {
      const d = new Date(row.createdAt);
      let label: string;
      let isToday = false;

      if (this.isSameDay(d, today)) {
        label = `Today · ${d.toLocaleDateString('en-US', dateOpts)}`;
        isToday = true;
      } else if (this.isSameDay(d, yesterday)) {
        label = `Yesterday · ${d.toLocaleDateString('en-US', dateOpts)}`;
      } else {
        label = 'Earlier this week';
      }

      if (!groups.has(label)) {
        groups.set(label, { rows: [], isToday });
        order.push(label);
      }
      groups.get(label)!.rows.push(row);
    }

    return order.map((label) => {
      const g = groups.get(label)!;
      return { label, isToday: g.isToday, rows: g.rows };
    });
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
}
