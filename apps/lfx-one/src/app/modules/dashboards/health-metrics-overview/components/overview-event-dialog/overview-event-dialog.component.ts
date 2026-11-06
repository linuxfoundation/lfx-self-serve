// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HEALTH_METRICS_OVERVIEW_EVENT_DIALOG_TABS, lfxColors } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewEventDialogBadges, buildHealthMetricsOverviewTrendMeta, slugify } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { downloadCardAsImage } from '@shared/utils/download-card.util';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, forkJoin, map, Observable, of, tap } from 'rxjs';

import { OverviewEventSnapshotComponent } from '../overview-event-snapshot/overview-event-snapshot.component';
import { OverviewEventTrendComponent } from '../overview-event-trend/overview-event-trend.component';

import type {
  HealthMetricsOverviewCardStatus,
  HealthMetricsOverviewEventDialogBadgesView,
  HealthMetricsOverviewEventDialogData,
  HealthMetricsOverviewEventDialogTab,
  HealthMetricsOverviewEventTrendReads,
  UiTabItem,
} from '@lfx-one/shared/interfaces';

/**
 * The event dialog the Overview Events card opens, through `DialogService`: the event's name, goal and days left over
 * two tabs, Registration trend and Snapshot, and a Download PNG of the tab on show. Closing it discards the tab,
 * the chart's state and the Snapshot period with it.
 */
@Component({
  selector: 'lfx-overview-event-dialog',
  imports: [OverviewEventSnapshotComponent, OverviewEventTrendComponent, UiBadgeComponent, UiButtonComponent, UiTabsComponent],
  templateUrl: './overview-event-dialog.component.html',
})
export class OverviewEventDialogComponent {
  /** Names the dialog; see `nameDynamicDialog`. */
  public static readonly headingId = 'overview-event-dialog-title';

  private readonly analyticsService = inject(AnalyticsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<HealthMetricsOverviewEventDialogData>);
  private readonly toast = inject(UiToastService);

  protected readonly event = this.dialogConfig.data!.event;
  protected readonly isPast = this.dialogConfig.data!.isPast;
  protected readonly headingId = OverviewEventDialogComponent.headingId;
  protected readonly meta = buildHealthMetricsOverviewTrendMeta(this.event);
  protected readonly tabs: UiTabItem[] = HEALTH_METRICS_OVERVIEW_EVENT_DIALOG_TABS.map((tab) => ({ ...tab }));
  protected readonly tab = signal<HealthMetricsOverviewEventDialogTab>(this.dialogConfig.data!.tab);
  /** Latches once Snapshot shows, so going back to it does not read it again. */
  protected readonly snapshotShown = signal<boolean>(this.tab() === 'snapshot');
  protected readonly status = signal<HealthMetricsOverviewCardStatus>('loading');
  protected readonly exporting = signal<boolean>(false);
  /** A field so a spec can stand in for the capture, which jsdom cannot draw. */
  protected readonly exportImage = downloadCardAsImage;
  protected readonly reads = this.initReads();
  protected readonly badges = computed<HealthMetricsOverviewEventDialogBadgesView>(() => {
    const headline = this.reads()?.forecast?.events.find((candidate) => candidate.eventId === this.event.eventId) ?? null;
    return buildHealthMetricsOverviewEventDialogBadges(this.event, this.isPast, headline);
  });

  private readonly heading = viewChild.required<ElementRef<HTMLElement>>('heading');
  private readonly trendPanel = viewChild.required<ElementRef<HTMLElement>>('trendPanel');
  private readonly snapshotPanel = viewChild<ElementRef<HTMLElement>>('snapshotPanel');
  private readonly snapshot = viewChild(OverviewEventSnapshotComponent);
  /** A loading or failed tab has nothing worth saving, so Download PNG waits for the tab on show to be read. */
  protected readonly canExport = computed(() => (this.tab() === 'snapshot' ? this.snapshot()?.status() : this.status()) === 'ready');

  public constructor() {
    // The title takes focus, so a screen reader names the event and no ring lands on the close button.
    afterNextRender(() => this.heading().nativeElement.focus());
  }

  protected onTabChange(value: string): void {
    const tab = value === 'snapshot' ? 'snapshot' : 'trend';
    this.tab.set(tab);
    if (tab === 'snapshot') this.snapshotShown.set(true);
  }

  protected close(): void {
    this.dialogRef.close();
  }

  /** Exports the tab on show, named after the event and the tab, on white so it reads outside the dialog. */
  protected async downloadPng(): Promise<void> {
    const tab = this.tabs.find((candidate) => candidate.value === this.tab());
    const panel = this.tab() === 'snapshot' ? this.snapshotPanel() : this.trendPanel();
    if (!tab || !panel || !this.canExport() || this.exporting()) return;

    this.exporting.set(true);
    // Widens the panel to its tables for the capture, so a narrow screen's scrolled-off columns are in the image.
    panel.nativeElement.setAttribute('data-exporting', '');
    const exported = await this.exportImage(panel.nativeElement, `${slugify(this.event.eventName) || 'event'}-${slugify(tab.label)}`, {
      backgroundColor: lfxColors.white,
    });
    panel.nativeElement.removeAttribute('data-exporting');
    this.exporting.set(false);

    this.toast.show(
      exported
        ? { variant: 'dark', message: `${tab.label} downloaded as PNG` }
        : { variant: 'error', message: `${tab.label} could not be downloaded. Try again.` }
    );
  }

  /** Headline and curve for an upcoming event, the history alone for a past one; a failed read says so instead of drawing nothing. */
  private initReads() {
    const query = { foundationSlug: this.projectContextService.selectedFoundation()?.slug ?? '', eventId: this.event.eventId };
    const reads: Observable<HealthMetricsOverviewEventTrendReads> = this.isPast
      ? this.analyticsService.getEventsRegistrationHistory(query).pipe(map((curve) => ({ forecast: null, curve })))
      : forkJoin({
          forecast: this.analyticsService.getEventsRegistrationForecast({ foundationSlug: query.foundationSlug }),
          curve: this.analyticsService.getEventsRegistrationForecastCurve(query),
        });

    return toSignal(
      reads.pipe(
        tap(() => this.status.set('ready')),
        catchError(() => {
          this.status.set('failed');
          return of(null);
        })
      ),
      { initialValue: null }
    );
  }
}
