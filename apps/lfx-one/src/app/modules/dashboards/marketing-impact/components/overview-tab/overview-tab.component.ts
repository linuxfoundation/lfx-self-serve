// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';

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
   * The events sections always render. They serve both the All view (unsplit,
   * eventsSplit=null, consolidating across campaign types) and the Events view (split,
   * eventsSplit='attendance'|'sponsorship'). There is no third case: the focus programs
   * with no content (COMING_SOON_FOCUS_PROGRAMS) are gated by the parent's coming-soon
   * branch and never reach this component.
   */
  /** Attendance sections render unless sponsorship is explicitly selected. */
  protected readonly showAttendance = computed(() => this.eventsSplit() !== 'sponsorship');
}
