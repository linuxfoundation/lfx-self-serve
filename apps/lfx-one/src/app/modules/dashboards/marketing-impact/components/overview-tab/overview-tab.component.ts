// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';

import type { EventsSplitView, MarketingImpactFocusProgram } from '@lfx-one/shared/interfaces';

import { EventRosterSectionComponent } from '../event-roster-section/event-roster-section.component';
import { EventsAttentionSectionComponent } from '../events-attention-section/events-attention-section.component';
import { EventsSummarySectionComponent } from '../events-summary-section/events-summary-section.component';

/**
 * Marketing Impact overview tab — the LF Events story: at-risk events, the events summary,
 * and the event roster (with the per-event deep-dive drawer).
 */
@Component({
  selector: 'lfx-overview-tab',
  imports: [EventsSummarySectionComponent, EventRosterSectionComponent, EventsAttentionSectionComponent],
  templateUrl: './overview-tab.component.html',
})
export class OverviewTabComponent {
  // === Inputs ===
  public readonly foundationSlug = input<string | undefined>();
  public readonly foundationName = input<string>('');
  // Passed through to the summary tiles and the roster, both of which filter by it.
  public readonly selectedPeriod = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');
  // null when the split control is hidden, which means "show both attendance and sponsorship".
  public readonly eventsSplit = input<EventsSplitView | null>(null);
}
