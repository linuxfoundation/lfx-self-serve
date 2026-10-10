// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MEETING_AGENDA_COLLAPSED_HEIGHT_PX } from '@lfx-one/shared/constants';
import { buildMeetingEditCommands, buildMeetingEditQueryParams } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 agenda section, first in the content column (E3-01, #3250, FR-030).
 * @description The meeting's description, free text with its links made clickable, collapsed past
 * the public page's height with "See more". Discrete agenda items are Phase 2 (E9, blocked upstream
 * on U-07): the description is never parsed into items here.
 *
 * The page renders this section only when `visibleSections().agenda` says so (hidden for an ended
 * meeting without artifact access, as V1 hides it). An organizer of a meeting that has not ended gets
 * Edit agenda, a link to the meeting's edit page built by the meeting cards' helpers.
 */
@Component({
  selector: 'lfx-meeting-agenda',
  imports: [RouterLink, ExpandableTextComponent, LinkifyPipe],
  templateUrl: './agenda.component.html',
})
export class MeetingAgendaComponent {
  private readonly state = inject(MeetingDetailsStateService);

  protected readonly collapsedHeight = MEETING_AGENDA_COLLAPSED_HEIGHT_PX;
  /** The selected occurrence's own agenda first, else the series', as V1 reads it. */
  protected readonly description = computed(() => (this.state.selectedOccurrence()?.description || this.state.meeting()?.description)?.trim() ?? '');
  /**
   * Edit agenda: organizers only, and not once the meeting has ended (as V1 hides organizer edits on a
   * past meeting): a past record's id is not the series the edit page edits.
   */
  protected readonly canEdit = computed(() => this.state.meeting()?.organizer === true && this.state.timeState() !== 'ended');
  /** The meeting's edit page and its query params, built by the same helpers as the meeting cards. */
  protected readonly editCommands: Signal<string[]> = this.initEditCommands();
  protected readonly editQueryParams: Signal<Record<string, string>> = this.initEditQueryParams();

  private initEditCommands(): Signal<string[]> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting) {
        return [];
      }
      return buildMeetingEditCommands(meeting);
    });
  }

  private initEditQueryParams(): Signal<Record<string, string>> {
    return computed((): Record<string, string> => {
      const meeting = this.state.meeting();
      return meeting ? buildMeetingEditQueryParams(meeting, meeting.project?.slug) : {};
    });
  }
}
