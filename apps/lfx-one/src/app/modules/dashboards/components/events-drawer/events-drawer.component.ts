// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, model, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ChartComponent } from '@components/chart/chart.component';
import { SelectComponent } from '@components/select/select.component';
import { DEFAULT_FOUNDATION_EVENTS_ATTENDANCE_DISTRIBUTION, DEFAULT_FOUNDATION_EVENTS_QUARTERLY, lfxColors } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { DrawerModule } from 'primeng/drawer';
import { catchError, forkJoin, of, skip, switchMap, tap } from 'rxjs';

import type { ChartData, ChartOptions } from 'chart.js';
import type {
  FoundationEventsAttendanceDistributionResponse,
  FoundationEventsQuarterlyResponse,
  HealthEventsMonthlyResponse,
} from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-events-drawer',
  imports: [DrawerModule, ChartComponent, SelectComponent, ReactiveFormsModule],
  templateUrl: './events-drawer.component.html',
})
export class EventsDrawerComponent {
  // === Services ===
  private readonly projectContextService = inject(ProjectContextService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly fb = inject(FormBuilder);

  // === Static Options ===
  protected readonly timeRangeOptions = [{ label: 'Last 12 months', value: 'last-12-months' }];

  protected readonly quarterlyChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => ` ${(ctx.parsed.y as number).toLocaleString()} events`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: false },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, maxRotation: 0 },
      },
      y: {
        display: true,
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: false, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, callback: (v) => (v as number).toLocaleString() },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7, borderRadius: 3 } },
  };

  protected readonly attendanceChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        titleColor: lfxColors.gray[900],
        bodyColor: lfxColors.gray[600],
        borderColor: lfxColors.gray[200],
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          title: (ctx) => {
            const bucket = this.attendanceData().distribution[ctx[0].dataIndex];
            const bucketLabels: Record<string, string> = {
              Large: 'Large (1000+)',
              Medium: 'Medium (200-999)',
              Small: 'Small (<200)',
            };
            return bucketLabels[bucket?.bucket ?? ''] ?? bucket?.bucket ?? '';
          },
          label: (ctx) => ` events : ${(ctx.parsed.y as number).toLocaleString()}`,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: { display: false },
        border: { display: true, color: lfxColors.gray[400], width: 1 },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4 },
      },
      y: {
        display: true,
        title: { display: true, text: 'Events', color: lfxColors.gray[500], font: { size: 11 } },
        grid: { color: lfxColors.gray[200], lineWidth: 1 },
        border: { display: true, color: lfxColors.gray[400], width: 1, dash: [3, 3] },
        ticks: { color: lfxColors.gray[500], font: { size: 12 }, padding: 4, callback: (v) => `${v}` },
        beginAtZero: true,
      },
    },
    datasets: { bar: { barPercentage: 0.6, categoryPercentage: 0.7, borderRadius: 3 } },
  };

  // === Forms ===
  protected readonly headerForm: FormGroup = this.fb.group({
    timeRange: [{ value: 'last-12-months', disabled: true }],
  });

  // === Inputs ===
  public readonly data = input<HealthEventsMonthlyResponse>({ data: [], totalEvents: 0, totalMonths: 0 });

  // === Model Signals (two-way binding) ===
  public readonly visible = model<boolean>(false);

  // === WritableSignals ===
  protected readonly drawerLoading = signal(false);

  // === Computed Signals ===
  protected readonly metricValue: Signal<string> = computed(() => this.data().totalEvents.toLocaleString());
  protected readonly hasData: Signal<boolean> = computed(() => this.data().totalEvents > 0);

  private readonly drawerData = this.initDrawerData();
  protected readonly quarterlyData: Signal<FoundationEventsQuarterlyResponse> = computed(() => this.drawerData().quarterly);
  protected readonly attendanceData: Signal<FoundationEventsAttendanceDistributionResponse> = computed(() => this.drawerData().attendance);
  protected readonly hasQuarterlyData: Signal<boolean> = computed(() => this.quarterlyData().quarterlyData.length > 0);
  protected readonly hasAttendanceData: Signal<boolean> = computed(() => this.attendanceData().distribution.length > 0);

  protected readonly quarterlyChartData: Signal<ChartData<'bar'>> = this.initQuarterlyChartData();
  protected readonly attendanceChartData: Signal<ChartData<'bar'>> = this.initAttendanceChartData();

  // === Protected Methods ===
  protected onClose(): void {
    this.visible.set(false);
  }

  // === Private Initializers ===
  private initDrawerData(): Signal<{ quarterly: FoundationEventsQuarterlyResponse; attendance: FoundationEventsAttendanceDistributionResponse }> {
    const defaultValue = { quarterly: DEFAULT_FOUNDATION_EVENTS_QUARTERLY, attendance: DEFAULT_FOUNDATION_EVENTS_ATTENDANCE_DISTRIBUTION };
    return toSignal(
      toObservable(this.visible).pipe(
        skip(1),
        switchMap((isVisible) => {
          if (!isVisible) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          this.drawerLoading.set(true);
          const slug = this.projectContextService.selectedFoundation()?.slug ?? '';
          if (!slug) {
            this.drawerLoading.set(false);
            return of(defaultValue);
          }
          return forkJoin({
            quarterly: this.analyticsService.getFoundationEventsQuarterly(slug),
            attendance: this.analyticsService.getFoundationEventsAttendanceDistribution(slug),
          }).pipe(
            tap(() => this.drawerLoading.set(false)),
            catchError(() => {
              this.drawerLoading.set(false);
              return of(defaultValue);
            })
          );
        })
      ),
      { initialValue: defaultValue }
    );
  }

  private initQuarterlyChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { quarterlyData, quarterlyLabels } = this.quarterlyData();
      return {
        labels: quarterlyLabels,
        datasets: [
          {
            data: quarterlyData,
            backgroundColor: lfxColors.blue[400],
            borderRadius: 3,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }

  private initAttendanceChartData(): Signal<ChartData<'bar'>> {
    return computed(() => {
      const { distribution } = this.attendanceData();
      const bucketLabels: Record<string, string> = {
        Large: 'Large (1000+)',
        Medium: 'Medium (200-999)',
        Small: 'Small (<200)',
      };
      const bucketColors: Record<string, string> = {
        Large: lfxColors.gray[400],
        Medium: lfxColors.emerald[400],
        Small: lfxColors.violet[500],
      };
      return {
        labels: distribution.map((d) => bucketLabels[d.bucket] ?? d.bucket),
        datasets: [
          {
            data: distribution.map((d) => d.eventCount),
            backgroundColor: distribution.map((d) => bucketColors[d.bucket] ?? lfxColors.gray[400]),
            borderRadius: 3,
            borderSkipped: 'start',
          },
        ],
      };
    });
  }
}
