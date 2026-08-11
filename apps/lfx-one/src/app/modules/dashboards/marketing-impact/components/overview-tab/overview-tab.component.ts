// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { EVENTS_SPLIT_FOCUS } from '@lfx-one/shared/constants';

import type { EventsSplitView, MarketingImpactFocusProgram } from '@lfx-one/shared/interfaces';

import { EventRosterSectionComponent } from '../event-roster-section/event-roster-section.component';
import { EventsAttentionSectionComponent } from '../events-attention-section/events-attention-section.component';
import { EventsSummarySectionComponent } from '../events-summary-section/events-summary-section.component';

/**
 * Campaign Impact overview tab — the LF Events story: at-risk events, the events summary,
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
  /** Scopes the events summary and roster to the picked period; forwarded to both sections. */
  public readonly selectedPeriod = input<string>('');
  public readonly focusProgram = input<MarketingImpactFocusProgram>('all');
  /**
   * Which half of the Events story to render. `null` means the campaign type does not split
   * (All, and the non-Events types), so every section renders as it did before the split.
   */
  public readonly eventsSplit = input<EventsSplitView | null>(null);

  // === Computed Signals ===
  /**
   * The events sections render for both the All view (unsplit, eventsSplit=null) and the
   * Events view (split, eventsSplit='attendance'|'sponsorship'). The All view consolidates
   * across all campaign types; the Events view shows attendance and sponsorship splits.
   */
  protected readonly showEventsSections = computed(() => this.focusProgram() === EVENTS_SPLIT_FOCUS || this.eventsSplit() !== null);
  /** Attendance sections render unless sponsorship is explicitly selected. */
  protected readonly showAttendance = computed(() => this.eventsSplit() !== 'sponsorship');
  /** Sponsorship sections render unless attendance is explicitly selected. */
  protected readonly showSponsorship = computed(() => this.eventsSplit() !== 'attendance');
}
