// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import type { MarketingImpactFocusProgram } from '@lfx-one/shared/interfaces';

import { EventRosterSectionComponent } from '../event-roster-section/event-roster-section.component';
import { EventsAttentionSectionComponent } from '../events-attention-section/events-attention-section.component';
import { EventsGeoSectionComponent } from '../events-geo-section/events-geo-section.component';
import { EventsSummarySectionComponent } from '../events-summary-section/events-summary-section.component';

/**
 * Marketing Impact overview tab — the LF Events story: at-risk events, the events summary,
 * the event roster (with the per-event deep-dive drawer), and geographic reach.
 */
@Component({
  selector: 'lfx-overview-tab',
  imports: [EventsSummarySectionComponent, EventRosterSectionComponent, EventsAttentionSectionComponent, EventsGeoSectionComponent],
  templateUrl: './overview-tab.component.html',
})
export class OverviewTabComponent {
  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');
  // Accepted from the parent page for API symmetry; the events sections are YTD-scoped and
  // foundation-scoped, so they are not consumed here.
  public readonly selectedPeriod = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');
}
