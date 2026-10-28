// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { HEALTH_METRICS_OVERVIEW_BLANK_TILES } from '@lfx-one/shared/constants';
import { buildHealthMetricsBlankCopy, toHealthMetricsOverviewPastYear } from '@lfx-one/shared/utils';

import { HealthMetricsBlankCardComponent } from '../components/health-metrics-blank-card/health-metrics-blank-card.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

import { OverviewBalanceCardComponent } from './components/overview-balance-card/overview-balance-card.component';
import { OverviewBoardCardComponent } from './components/overview-board-card/overview-board-card.component';
import { OverviewChurnCardComponent } from './components/overview-churn-card/overview-churn-card.component';
import { OverviewCodeCardComponent } from './components/overview-code-card/overview-code-card.component';
import { OverviewEventsCardComponent } from './components/overview-events-card/overview-events-card.component';
import { OverviewNpsCardComponent } from './components/overview-nps-card/overview-nps-card.component';
import { OverviewOrgsCardComponent } from './components/overview-orgs-card/overview-orgs-card.component';
import { OverviewTrainingCardComponent } from './components/overview-training-card/overview-training-card.component';
import { OverviewEmptyTrackerService } from './overview-empty-tracker.service';

import type { HealthMetricsBlankCopy } from '@lfx-one/shared/interfaces';

/**
 * The Health Metrics Overview: one card per area, each reading and failing on its own. When every card settles
 * empty, one blank card takes their place; the cards stay mounted, so a period change can bring them back.
 */
@Component({
  selector: 'lfx-health-metrics-overview',
  imports: [
    HealthMetricsBlankCardComponent,
    OverviewBalanceCardComponent,
    OverviewBoardCardComponent,
    OverviewChurnCardComponent,
    OverviewCodeCardComponent,
    OverviewEventsCardComponent,
    OverviewNpsCardComponent,
    OverviewOrgsCardComponent,
    OverviewTrainingCardComponent,
  ],
  templateUrl: './health-metrics-overview.component.html',
  providers: [OverviewEmptyTrackerService],
  host: { class: 'block' },
})
export class HealthMetricsOverviewComponent {
  private readonly chrome = inject(HealthMetricsChromeService);
  private readonly emptyTracker = inject(OverviewEmptyTrackerService);

  protected readonly blankTiles = HEALTH_METRICS_OVERVIEW_BLANK_TILES;
  protected readonly blank: Signal<HealthMetricsBlankCopy | null> = this.initBlank();

  private initBlank(): Signal<HealthMetricsBlankCopy | null> {
    return computed(() => (this.emptyTracker.allEmpty() ? buildHealthMetricsBlankCopy(toHealthMetricsOverviewPastYear(this.chrome.selectedRange())) : null));
  }
}
