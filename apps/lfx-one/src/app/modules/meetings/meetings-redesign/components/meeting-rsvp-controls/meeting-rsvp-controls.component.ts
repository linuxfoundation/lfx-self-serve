// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal } from '@angular/core';
import { MEETINGS_HOME_RSVP_CHOICES } from '@lfx-one/shared/constants';
import {
  MeetingHomeRow,
  MeetingRsvp,
  MeetingRsvpChoice,
  MeetingRsvpScopeDialogData,
  MeetingRsvpSubmitError,
  RsvpResponse,
  RsvpScope,
} from '@lfx-one/shared/interfaces';
import { getMeetingRsvpScopeLabel, isMeetingInviteResponsesEnabled } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { take } from 'rxjs';

import { MeetingRsvpScopeModalComponent } from '../meeting-rsvp-scope-modal/meeting-rsvp-scope-modal.component';

/**
 * The viewer's RSVP on one upcoming date: Yes / No / Maybe until answered, then a status badge whose menu changes it.
 * @description A recurring meeting asks which dates the answer covers first. Renders nothing when the viewer can't respond.
 */
@Component({
  selector: 'lfx-meeting-rsvp-controls',
  imports: [CdkMenuTrigger, UiBadgeComponent, UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiSpinnerComponent],
  templateUrl: './meeting-rsvp-controls.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The controls sit inside a clickable row; their clicks are not a click on the row.
  host: { class: 'contents', '(click)': '$event.stopPropagation()' },
})
export class MeetingRsvpControlsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly rsvpService = inject(MeetingRsvpService);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly row = input.required<MeetingHomeRow>();

  /** The answer being saved; the BFF holds the request until the new answer is indexed (up to 5s). */
  protected readonly saving = signal<RsvpResponse | null>(null);
  protected readonly choices = MEETINGS_HOME_RSVP_CHOICES;
  protected readonly iconColor: Record<RsvpResponse, string> = { accepted: 'text-blue-600', declined: 'text-red-600', maybe: 'text-amber-600' };
  protected readonly visible: Signal<boolean> = this.initVisible();
  protected readonly current: Signal<MeetingRsvpChoice | null> = computed(
    () => this.choices.find((choice) => choice.response === this.row().myRsvp?.response_type) ?? null
  );
  protected readonly scopeLabel: Signal<string | null> = computed(() => {
    const rsvp = this.row().myRsvp;
    return rsvp && this.row().meeting.recurrence ? getMeetingRsvpScopeLabel(rsvp) : null;
  });

  protected choose(response: RsvpResponse): void {
    const row = this.row();
    // A recurring answer can be re-picked to change the dates it covers.
    if (this.saving() || (!row.meeting.recurrence && response === this.current()?.response)) return;
    if (!row.meeting.recurrence) {
      this.submit(row, response, 'all');
      return;
    }

    const data: MeetingRsvpScopeDialogData = { row, response };
    const ref = this.modal.open<RsvpScope, MeetingRsvpScopeDialogData>(MeetingRsvpScopeModalComponent, { data });
    // A row that leaves the list takes its open dialog with it, saving nothing.
    const stopClosingOnDestroy = this.destroyRef.onDestroy(() => ref.close());
    ref.closed.pipe(take(1)).subscribe((scope) => {
      stopClosingOnDestroy();
      if (scope) this.submit(row, response, scope);
    });
  }

  private initVisible(): Signal<boolean> {
    return computed(() => {
      const { meeting, myRsvp } = this.row();
      // Unloaded RSVPs (undefined) could hide an earlier answer, and without a registration a save cannot resolve a registrant.
      const answerable = myRsvp !== undefined && meeting.my_registrant_ids?.length !== 0;
      // Organizers keep their rows after removing their own registration, but can no longer answer.
      return meeting.invited && answerable && isMeetingInviteResponsesEnabled(meeting) && !this.meetingService.removedRegistrationMeetingIds().has(meeting.id);
    });
  }

  private submit(row: MeetingHomeRow, response: RsvpResponse, scope: RsvpScope): void {
    if (this.saving()) return;
    this.saving.set(response);
    this.rsvpService
      .submit$(row.meeting, row.occurrenceId ?? undefined, response, scope)
      .pipe(take(1))
      .subscribe({
        next: (rsvp: MeetingRsvp) => {
          const label = this.choices.find((choice) => choice.response === rsvp.response_type)?.label ?? '';
          const scopeLabel = row.meeting.recurrence ? getMeetingRsvpScopeLabel(rsvp) : 'This meeting';
          this.toast.show({ variant: 'dark', message: `Response saved: ${label}`, description: `${row.title} — ${scopeLabel}` });
        },
        error: (error: MeetingRsvpSubmitError) => {
          this.saving.set(null);
          this.toast.show({ variant: 'dark', message: 'RSVP Failed', description: error.message, duration: 5000 });
        },
        complete: () => this.saving.set(null),
      });
  }
}
