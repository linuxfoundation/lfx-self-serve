// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MEETING_AGENDA_COLLAPSED_HEIGHT_PX } from '@lfx-one/shared/constants';
import { LinkifyPipe } from '@pipes/linkify.pipe';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 agenda section, first in the content column (E3-01, #3250, FR-030).
 * @description The meeting's description, free text with its links made clickable, collapsed past
 * the public page's height with "See more". Discrete agenda items are Phase 2 (E9, blocked upstream
 * on U-07): the description is never parsed into items here.
 *
 * The page renders this section only when `visibleSections().agenda` says so (hidden for an ended
 * meeting without artifact access, as V1 hides it). Like V1, the section has no edit control.
 */
@Component({
  selector: 'lfx-meeting-agenda',
  imports: [ExpandableTextComponent, LinkifyPipe],
  templateUrl: './agenda.component.html',
})
export class MeetingAgendaComponent {
  private readonly state = inject(MeetingDetailsStateService);

  protected readonly collapsedHeight = MEETING_AGENDA_COLLAPSED_HEIGHT_PX;
  /**
   * The selected occurrence's own agenda first, else the series', as V1 reads it. Each is trimmed
   * before the choice, so a blank occurrence description never hides the series' agenda.
   */
  protected readonly description = computed(() => this.state.selectedOccurrence()?.description?.trim() || this.state.meeting()?.description?.trim() || '');
}
