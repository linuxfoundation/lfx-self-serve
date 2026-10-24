// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';

import { OverviewBalanceCardComponent } from './components/overview-balance-card/overview-balance-card.component';
import { OverviewBoardCardComponent } from './components/overview-board-card/overview-board-card.component';
import { OverviewChurnCardComponent } from './components/overview-churn-card/overview-churn-card.component';
import { OverviewCodeCardComponent } from './components/overview-code-card/overview-code-card.component';
import { OverviewEventsCardComponent } from './components/overview-events-card/overview-events-card.component';
import { OverviewNpsCardComponent } from './components/overview-nps-card/overview-nps-card.component';
import { OverviewOrgsCardComponent } from './components/overview-orgs-card/overview-orgs-card.component';
import { OverviewTrainingCardComponent } from './components/overview-training-card/overview-training-card.component';

/** The Health Metrics Overview: one card per area, each reading and failing on its own. */
@Component({
  selector: 'lfx-health-metrics-overview',
  imports: [
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
  host: { class: 'block' },
})
export class HealthMetricsOverviewComponent {}
