// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MEETING_AGENDA_COLLAPSED_HEIGHT_PX } from '@lfx-one/shared/constants';
import { getEntityCommands } from '@lfx-one/shared/utils';
import { LinkifyPipe } from '@pipes/linkify.pipe';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';

/**
 * The V2 agenda section, first in the content column (E3-01, #3250, FR-030).
 * @description The meeting's description, free text with its links made clickable, collapsed past
 * the public page's height with "See more". Discrete agenda items are Phase 2 (E9, blocked upstream
 * on U-07): the description is never parsed into items here.
 *
 * The page renders this section only when `visibleSections().agenda` says so: an ended meeting
 * without artifact access has no description in its payload. An organizer gets Edit agenda, a link to
 * the meeting's edit page, built as the meeting cards build it.
 */
@Component({
  selector: 'lfx-meeting-agenda',
  imports: [RouterLink, ExpandableTextComponent, LinkifyPipe],
  templateUrl: './agenda.component.html',
})
export class MeetingAgendaComponent {
  private readonly state = inject(MeetingDetailsStateService);

  protected readonly collapsedHeight = MEETING_AGENDA_COLLAPSED_HEIGHT_PX;
  protected readonly description = computed(() => this.state.meeting()?.description?.trim() ?? '');
  protected readonly organizer = computed(() => this.state.meeting()?.organizer === true);
  /** The meeting's edit page, under its project or foundation when known, else the bare route. */
  protected readonly editCommands: Signal<string[]> = this.initEditCommands();
  /** The project the edit page opens on, as the meeting cards pass it. */
  protected readonly editQueryParams: Signal<Record<string, string>> = this.initEditQueryParams();

  private initEditCommands(): Signal<string[]> {
    return computed(() => {
      const meeting = this.state.meeting();
      if (!meeting) {
        return [];
      }
      return getEntityCommands('meetings', meeting.id, meeting.is_foundation, 'edit') ?? ['/meetings', meeting.id, 'edit'];
    });
  }

  private initEditQueryParams(): Signal<Record<string, string>> {
    return computed((): Record<string, string> => {
      const meeting = this.state.meeting();
      const slug = meeting?.project_slug || meeting?.project?.slug;
      return slug ? { project: slug } : {};
    });
  }
}
