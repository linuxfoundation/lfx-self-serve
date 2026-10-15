// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { Component, computed, ElementRef, inject } from '@angular/core';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { MEETING_AGENDA_COLLAPSED_HEIGHT_PX } from '@lfx-one/shared/constants';
import { MeetingEditAgendaDialogData, MeetingEditAgendaDialogResult } from '@lfx-one/shared/interfaces';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { nameDynamicDialog } from '@shared/utils/name-dynamic-dialog';
import { restoreFocusOnDialogClose } from '@shared/utils/restore-dialog-focus.util';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingEditAgendaDialogComponent } from '../edit-agenda-dialog/edit-agenda-dialog.component';

/**
 * The V2 agenda section, first in the content column (E3-01, #3250, FR-030).
 * @description The meeting's description, free text with its links made clickable, collapsed past
 * the public page's height with "See more". Discrete agenda items are Phase 2 (E9, blocked upstream
 * on U-07): the description is never parsed into items here.
 *
 * The page renders this section only when `visibleSections().agenda` says so (hidden for an ended
 * meeting without artifact access, as V1 hides it). An organizer of a meeting that has not ended gets
 * Edit agenda, which opens the edit-agenda dialog on the page (O-01, #3604) for what the section shows:
 * the selected occurrence's own agenda, else the series'. A save shows at once (`agendaOverride`) and
 * the page re-reads the meeting.
 */
@Component({
  selector: 'lfx-meeting-agenda',
  imports: [ExpandableTextComponent, LinkifyPipe],
  providers: [DialogService],
  templateUrl: './agenda.component.html',
})
export class MeetingAgendaComponent {
  private readonly state = inject(MeetingDetailsStateService);
  private readonly dialogService = inject(DialogService);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly collapsedHeight = MEETING_AGENDA_COLLAPSED_HEIGHT_PX;
  /**
   * The selected occurrence's own agenda first, else the series', as V1 reads it. Each is trimmed
   * before the choice, so a blank occurrence description never hides the series' agenda.
   */
  protected readonly description = computed(() => {
    const override = this.state.agendaOverride();
    const meeting = this.state.meeting();
    const occurrence = this.state.selectedOccurrence();
    const own = occurrence?.description?.trim() || '';
    // A just-saved agenda, for what it edited, until the next read replaces it.
    if (override && override.meetingId === meeting?.id) {
      if (override.occurrenceId !== null && override.occurrenceId === occurrence?.occurrence_id) {
        return override.description;
      }
      if (override.occurrenceId === null && !own) {
        return override.description;
      }
    }
    return own || meeting?.description?.trim() || '';
  });
  /**
   * Edit agenda: organizers only, and not once the meeting has ended (as V1 hides organizer edits on a
   * past meeting): a past record's id is not the series the edit page edits.
   */
  protected readonly canEdit = computed(() => this.state.meeting()?.organizer === true && this.state.timeState() !== 'ended');
  /**
   * Opens the edit-agenda dialog on what the section shows: the selected occurrence's own agenda through
   * the occurrence API, else the series'. Inside the page's token scope; focus returns to Edit agenda.
   */
  protected openEditor(): void {
    const meeting = this.state.meeting();
    if (!meeting || !this.canEdit()) {
      return;
    }
    const occurrence = this.state.selectedOccurrence();
    const ownAgenda = !!occurrence?.description?.trim();
    const data: MeetingEditAgendaDialogData = {
      meetingId: meeting.id,
      scope: ownAgenda ? 'occurrence' : 'series',
      occurrence: ownAgenda && occurrence ? { occurrenceId: occurrence.occurrence_id, startTime: occurrence.start_time, duration: occurrence.duration } : null,
      recurring: !!meeting.recurrence,
      original: this.description(),
    };
    const trigger = this.document.activeElement;
    const ref = this.dialogService.open(MeetingEditAgendaDialogComponent, {
      showHeader: false,
      width: '560px',
      breakpoints: { '600px': 'calc(100vw - 40px)' },
      modal: true,
      closable: true,
      closeOnEscape: true,
      dismissableMask: false,
      appendTo: this.host.nativeElement.closest('.meeting-details-v2') ?? 'body',
      styleClass:
        '!rounded-[var(--md-radius-dialog)] !border !border-[var(--md-border)] !bg-[var(--md-surface-card)] !shadow-[var(--md-shadow-dialog)] overflow-hidden',
      data,
    });
    if (!ref) {
      return;
    }
    nameDynamicDialog(this.dialogService, ref, MeetingEditAgendaDialogComponent.headingId);
    restoreFocusOnDialogClose(ref, trigger);
    ref.onClose.pipe(take(1)).subscribe((result?: MeetingEditAgendaDialogResult) => {
      if (!result) {
        return;
      }
      this.state.agendaOverride.set({ meetingId: meeting.id, occurrenceId: data.occurrence?.occurrenceId ?? null, description: result.description });
      this.state.reload();
    });
  }
}
