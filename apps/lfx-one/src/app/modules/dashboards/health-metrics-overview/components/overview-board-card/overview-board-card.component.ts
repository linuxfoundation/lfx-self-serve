// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_BOARD_DEFAULT_SORT,
  HEALTH_METRICS_OVERVIEW_BOARD_SORT_COLUMNS,
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
} from '@lfx-one/shared/constants';
import {
  buildHealthMetricsOverviewAddPastMeetingUrl,
  buildHealthMetricsOverviewBoardView,
  healthMetricsOverviewBoardSortValue,
  sortHealthMetricsRows,
} from '@lfx-one/shared/utils';
import { environment } from '@environments/environment';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';

import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';
import { OverviewKpiStripComponent } from '../overview-kpi-strip/overview-kpi-strip.component';

import type { HealthMetricsOverviewBoardRowView, HealthMetricsOverviewBoardView } from '@lfx-one/shared/interfaces';

/** The board's meetings and average attendance, then every invited member, lowest attendance first. */
@Component({
  selector: 'lfx-overview-board-card',
  imports: [HealthMetricsThComponent, OverviewCardComponent, OverviewExploreLinkComponent, OverviewKpiStripComponent, UiAvatarComponent],
  templateUrl: './overview-board-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewBoardCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.board;
  protected readonly emptyCopy = HEALTH_METRICS_OVERVIEW_EMPTY_COPY.board;
  protected readonly table = injectHealthMetricsTableSort(HEALTH_METRICS_OVERVIEW_BOARD_SORT_COLUMNS, HEALTH_METRICS_OVERVIEW_BOARD_DEFAULT_SORT);
  /** `null` until the foundation's Salesforce id resolves, which hides the link rather than pointing it nowhere. */
  protected readonly addPastMeetingUrl = computed(() =>
    buildHealthMetricsOverviewAddPastMeetingUrl(environment.urls.pcc, this.projectContextService.selectedFoundationSfid())
  );
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewBoard({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewBoardView | null>(() => {
    const board = this.read.data();
    return board ? buildHealthMetricsOverviewBoardView(board, this.chrome.selectedRange()) : null;
  });
  protected readonly rows = computed<HealthMetricsOverviewBoardRowView[]>(() =>
    sortHealthMetricsRows(this.view()?.rows ?? [], this.table.sort(), healthMetricsOverviewBoardSortValue)
  );
}
