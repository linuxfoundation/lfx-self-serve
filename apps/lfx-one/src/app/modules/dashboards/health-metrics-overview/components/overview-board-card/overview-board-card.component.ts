// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_CARDS, HEALTH_METRICS_OVERVIEW_EMPTY_COPY } from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewAddPastMeetingUrl, buildHealthMetricsOverviewBoardView, sortHealthMetricsOverviewBoardRows } from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewBoardRowView, HealthMetricsOverviewBoardSort, HealthMetricsOverviewBoardView } from '@lfx-one/shared/interfaces';

/** The board's meetings and average attendance, then every invited member, lowest attendance first. */
@Component({
  selector: 'lfx-overview-board-card',
  imports: [OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent, TooltipModule],
  templateUrl: './overview-board-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewBoardCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.board;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.board;
  protected readonly sort = signal<HealthMetricsOverviewBoardSort>('att-asc');
  /** `null` until the foundation's Salesforce id resolves, which hides the link rather than pointing it nowhere. */
  protected readonly addPastMeetingUrl = computed(() =>
    buildHealthMetricsOverviewAddPastMeetingUrl(environment.urls.pcc, this.projectContextService.selectedFoundationSfid())
  );
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewBoard({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewBoardView | null>(() => {
    const board = this.read.data();
    return board ? buildHealthMetricsOverviewBoardView(board, this.chrome.selectedRange()) : null;
  });
  protected readonly rows = computed<HealthMetricsOverviewBoardRowView[]>(() => sortHealthMetricsOverviewBoardRows(this.view()?.rows ?? [], this.sort()));
  protected readonly nameAriaSort = computed(() => this.ariaSort('name'));
  protected readonly attendanceAriaSort = computed(() => this.ariaSort('att'));
  protected readonly nameSortIcon = computed(() => this.sortIcon('name'));
  protected readonly attendanceSortIcon = computed(() => this.sortIcon('att'));

  /** Each header flips its own column between ascending and descending, as in the design. */
  protected toggleSort(column: 'name' | 'att'): void {
    this.sort.set(this.sort() === `${column}-asc` ? `${column}-desc` : `${column}-asc`);
  }

  private ariaSort(column: 'name' | 'att'): 'ascending' | 'descending' | 'none' {
    const sort = this.sort();
    if (!sort.startsWith(column)) return 'none';
    return sort.endsWith('asc') ? 'ascending' : 'descending';
  }

  private sortIcon(column: 'name' | 'att'): string {
    const direction = this.ariaSort(column);
    if (direction === 'none') return 'fa-light fa-arrow-up-arrow-down';
    return direction === 'ascending' ? 'fa-solid fa-arrow-up' : 'fa-solid fa-arrow-down';
  }
}
