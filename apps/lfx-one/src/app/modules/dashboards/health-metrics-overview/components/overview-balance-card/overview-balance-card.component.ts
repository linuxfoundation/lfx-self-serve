// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import {
  HEALTH_METRICS_OVERVIEW_BALANCE_DEFAULT_SORT,
  HEALTH_METRICS_OVERVIEW_BALANCE_SORT_COLUMNS,
  HEALTH_METRICS_OVERVIEW_BALANCE_UNMEASURED_COPY,
  HEALTH_METRICS_OVERVIEW_CARDS,
  HEALTH_METRICS_OVERVIEW_EMPTY_COPY,
  HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS,
} from '@lfx-one/shared/constants';
import { buildHealthMetricsOverviewBalanceView, healthMetricsOverviewBalanceSortValue, sortHealthMetricsRows } from '@lfx-one/shared/utils';
import { AnalyticsService } from '@services/analytics.service';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';
import { injectHealthMetricsTableSort } from '../../../components/health-metrics-th/health-metrics-table-sort';
import { HealthMetricsThComponent } from '../../../components/health-metrics-th/health-metrics-th.component';
import { injectOverviewCardRead } from '../../overview-card-read';
import { OverviewCardComponent } from '../overview-card/overview-card.component';
import { OverviewExploreLinkComponent } from '../overview-explore-link/overview-explore-link.component';

import type { HealthMetricsOverviewBalanceRowView, HealthMetricsOverviewBalanceView } from '@lfx-one/shared/interfaces';

/** The period's overdue membership invoices, split into the high and medium risk bands. */
@Component({
  selector: 'lfx-overview-balance-card',
  imports: [HealthMetricsThComponent, OverviewCardComponent, OverviewExploreLinkComponent],
  templateUrl: './overview-balance-card.component.html',
  host: { class: 'flex min-w-0 flex-col' },
})
export class OverviewBalanceCardComponent {
  private readonly analyticsService = inject(AnalyticsService);
  private readonly chrome = inject(HealthMetricsChromeService);

  protected readonly card = HEALTH_METRICS_OVERVIEW_CARDS.balance;
  protected readonly link = HEALTH_METRICS_OVERVIEW_EXPLORE_LINKS.balance;
  protected readonly table = injectHealthMetricsTableSort(HEALTH_METRICS_OVERVIEW_BALANCE_SORT_COLUMNS, HEALTH_METRICS_OVERVIEW_BALANCE_DEFAULT_SORT);
  protected readonly read = injectOverviewCardRead((foundationSlug) => this.analyticsService.getOverviewOutstandingBalance({ foundationSlug }));
  protected readonly view = computed<HealthMetricsOverviewBalanceView | null>(() => {
    const data = this.read.data();
    return data ? buildHealthMetricsOverviewBalanceView(data, this.chrome.selectedRange()) : null;
  });
  /** The table follows the sort; the bar above keeps the bands in risk order. */
  protected readonly rows = computed<HealthMetricsOverviewBalanceRowView[]>(() =>
    sortHealthMetricsRows(this.view()?.rows ?? [], this.table.sort(), healthMetricsOverviewBalanceSortValue)
  );
  // Only a measured zero balance is good news; a missing balance is neutral.
  protected readonly emptyCopy = computed(() =>
    this.view()?.isPaidInFull ? HEALTH_METRICS_OVERVIEW_EMPTY_COPY.balance : HEALTH_METRICS_OVERVIEW_BALANCE_UNMEASURED_COPY
  );
}
