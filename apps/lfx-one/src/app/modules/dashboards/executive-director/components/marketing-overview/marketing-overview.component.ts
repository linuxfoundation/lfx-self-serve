// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, ViewChild } from '@angular/core';
import { MetricCardComponent } from '@components/metric-card/metric-card.component';
import { MARKETING_OVERVIEW_METRICS } from '@lfx-one/shared/constants';
import { DashboardMetricCard } from '@lfx-one/shared/interfaces';
import { ScrollShadowDirective } from '@shared/directives/scroll-shadow.directive';

@Component({
  selector: 'lfx-marketing-overview',
  imports: [MetricCardComponent, ScrollShadowDirective],
  templateUrl: './marketing-overview.component.html',
})
export class MarketingOverviewComponent {
  @ViewChild(ScrollShadowDirective) public scrollShadowDirective!: ScrollShadowDirective;

  protected readonly marketingCards: DashboardMetricCard[] = MARKETING_OVERVIEW_METRICS;
}
