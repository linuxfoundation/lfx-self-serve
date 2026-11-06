// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { MEETINGS_HOME_RSVP_CHOICES } from '@lfx-one/shared/constants';
import {
  MeetingHomeRow,
  MeetingRsvp,
  MeetingRsvpChoice,
  MeetingRsvpScopeDialogData,
  MeetingRsvpSubmitError,
  RsvpResponse,
  RsvpScope,
  UiButtonSize,
} from '@lfx-one/shared/interfaces';
import { getMeetingRsvpToastMessage, isMeetingInviteResponsesEnabled } from '@lfx-one/shared/utils';
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
 * The viewer's RSVP on one upcoming date: Yes / Maybe / No until answered, then a status badge whose menu changes it.
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
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly statusTrigger = viewChild<ElementRef<HTMLButtonElement>>('statusTrigger');

  public readonly row = input.required<MeetingHomeRow>();
  /** Size of the Yes / Maybe / No buttons: 28px in the list and the Pending RSVPs popover. */
  public readonly size = input<UiButtonSize>('small');

  /** The answer being saved; the BFF holds the request until the new answer is indexed (up to 5s). */
  protected readonly saving = signal<RsvpResponse | null>(null);
  protected readonly choices = MEETINGS_HOME_RSVP_CHOICES;
  // The badge sits at the row's end, so its menu opens from the badge's end edge.
  protected readonly menuPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom' },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  ];
  protected readonly iconColor: Record<RsvpResponse, string> = { accepted: 'text-emerald-600', declined: 'text-red-600', maybe: 'text-amber-600' };
  /** This row is saving, or another date of the same series is: a second write could be confirmed out of order. */
  protected readonly busy: Signal<boolean> = computed(() => !!this.saving() || this.rsvpService.submittingMeetingIds().has(this.row().meeting.id));
  protected readonly visible: Signal<boolean> = this.initVisible();
  protected readonly current: Signal<MeetingRsvpChoice | null> = computed(
    () => this.choices.find((choice) => choice.response === this.row().myRsvp?.response_type) ?? null
  );

  protected choose(response: RsvpResponse): void {
    const row = this.row();
    // A recurring answer can be re-picked to change the dates it covers.
    if (this.busy() || (!row.meeting.recurrence && response === this.current()?.response)) return;
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
      if (!scope) return;
      // Another date of the series started saving while the dialog was open.
      if (this.busy())
        this.toast.show({
          variant: 'warning',
          position: 'bottom-center',
          message: 'RSVP Not Saved',
          description: 'Another response to this meeting is still saving. Try again.',
          duration: 5000,
        });
      else this.submit(row, response, scope);
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
    if (this.busy()) return;
    this.saving.set(response);
    this.rsvpService
      .submit$(row.meeting, row.occurrenceId ?? undefined, response, scope)
      .pipe(take(1))
      .subscribe({
        next: (rsvp: MeetingRsvp) => {
          this.toast.show({ variant: 'dark', message: getMeetingRsvpToastMessage(rsvp, !!row.meeting.recurrence) });
          this.keepFocusOnRsvp();
        },
        error: (error: MeetingRsvpSubmitError) => {
          this.saving.set(null);
          this.toast.show({ variant: 'error', position: 'bottom-center', message: 'RSVP Failed', description: error.message });
        },
        complete: () => this.saving.set(null),
      });
  }

  /** A first answer swaps the focused button for the status badge, so focus follows it instead of dropping to the page. */
  private keepFocusOnRsvp(): void {
    if (!this.host.contains(this.document.activeElement)) return;
    afterNextRender(
      () => {
        const active = this.document.activeElement;
        if (!active || active === this.document.body) this.statusTrigger()?.nativeElement.focus();
      },
      { injector: this.injector }
    );
  }
}
