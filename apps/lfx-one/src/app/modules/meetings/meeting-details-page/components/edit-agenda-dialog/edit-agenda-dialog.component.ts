// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MEETING_AGENDA_MAX_LENGTH, MEETING_AGENDA_WARNING_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingEditAgendaDialogData, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { buildMeetingUpdateRequest, isMeetingOccurrenceCancelled } from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { lockDynamicDialogWhile } from '@shared/utils/lock-dynamic-dialog.util';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { firstValueFrom } from 'rxjs';

/**
 * The organizer's edit-agenda dialog (O-01, #3604): the agenda as one free-text value, edited on the page
 * instead of in the edit wizard (structured items wait for U-07, #2933).
 * @description It edits what the section shows: the selected occurrence's own agenda through the
 * occurrence API, else the series' (on a recurring meeting it says the change applies to every
 * occurrence). No new endpoint, and the server and upstream decide who may save.
 *
 * Saving first re-reads the meeting with the viewer's own token. That read is the conflict check (the
 * upstream API has no version or ETag): if the agenda changed since the dialog opened (or since the
 * organizer last saw it), the dialog shows the newer one and asks, rather than overwriting it; a second
 * Save then replaces the agenda the organizer has seen, and a third party's later change is caught again.
 * The read is also the source of what is sent: a series save is built from that full record with only the
 * agenda changed (`buildMeetingUpdateRequest`, never the page's public payload), and an occurrence save
 * sends the occurrence's current start and duration, so another organizer's change to them is kept. An
 * occurrence that has moved or been cancelled meanwhile is said so, and not saved to. A save in the
 * moment between that read and the write would still win; the API offers nothing narrower.
 */
@Component({
  selector: 'lfx-meeting-edit-agenda-dialog',
  imports: [ButtonComponent, ReactiveFormsModule, TextareaComponent],
  templateUrl: './edit-agenda-dialog.component.html',
})
export class MeetingEditAgendaDialogComponent {
  /** The heading's id: the caller names the dialog from it (`nameDynamicDialog`). */
  public static readonly headingId = 'meeting-edit-agenda-title';

  private readonly ref = inject(DynamicDialogRef);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  protected readonly data: MeetingEditAgendaDialogData = inject(DynamicDialogConfig).data;

  protected readonly headingId = MeetingEditAgendaDialogComponent.headingId;
  protected readonly maxLength = MEETING_AGENDA_MAX_LENGTH;
  protected readonly form = new FormGroup({
    agenda: new FormControl(this.data.original, { nonNullable: true, validators: [Validators.maxLength(MEETING_AGENDA_MAX_LENGTH)] }),
  });
  protected readonly primaryButtonClass =
    '!h-[38px] !rounded-full !border-[var(--md-accent)] !bg-[var(--md-accent)] !px-[18px] !text-[13.5px] !font-semibold !text-[var(--md-surface-card)] focus-visible:!shadow-[var(--md-shadow-focus)]';
  protected readonly secondaryButtonClass =
    '!h-[38px] !rounded-full !border !border-[var(--md-border-strong)] !bg-[var(--md-surface-card)] !px-[18px] !text-[13.5px] !font-semibold !text-[var(--md-text-heading)] hover:!bg-[var(--md-surface-hover)] focus-visible:!shadow-[var(--md-shadow-focus)]';

  protected readonly saving = signal(false);
  /** A newer agenda found on save: shown, with the choice to keep it or save over it. */
  protected readonly conflict = signal<string | null>(null);
  /** The occurrence being edited is no longer in the series (moved or cancelled): nothing to save to. */
  protected readonly moved = signal(false);
  protected readonly failed = signal(false);
  /** What a save is checked against: the agenda as opened, then any newer one the organizer has seen. */
  private readonly baseline = signal(this.data.original);

  private readonly value = toSignal(this.form.controls.agenda.valueChanges, { initialValue: this.data.original });
  protected readonly length = computed(() => this.value().length);
  protected readonly lengthTone = computed(() => {
    if (this.length() > MEETING_AGENDA_MAX_LENGTH) {
      return 'text-[var(--md-status-live)]';
    }
    return this.length() >= MEETING_AGENDA_WARNING_LENGTH ? 'text-[var(--md-status-warn)]' : 'text-[var(--md-text-muted)]';
  });
  /** An occurrence's own agenda cannot be emptied: upstream drops an empty value. */
  protected readonly emptyOccurrence = computed(() => this.data.scope === 'occurrence' && !this.value().trim());
  protected readonly canSave = computed(
    () => !this.saving() && !this.moved() && this.length() <= MEETING_AGENDA_MAX_LENGTH && !this.emptyOccurrence() && this.value().trim() !== this.baseline()
  );

  public constructor() {
    // No Escape or close while a save is in flight: it would land after the organizer thought it cancelled.
    lockDynamicDialogWhile(this.saving);
  }

  protected async save(): Promise<void> {
    if (!this.canSave()) {
      return;
    }
    const description = this.value().trim();
    this.saving.set(true);
    this.failed.set(false);
    try {
      const fresh = await firstValueFrom(this.meetingService.getMeetingDetail(this.data.meetingId, { skipCache: true }));
      const occurrence = this.freshOccurrence(fresh);
      if (this.data.scope === 'occurrence' && !occurrence) {
        this.moved.set(true);
        return;
      }
      const current = (occurrence ? occurrence.description : fresh.description)?.trim() ?? '';
      if (current !== this.baseline()) {
        // Shown, and from now on the baseline: a second Save replaces this one, knowingly.
        this.conflict.set(current);
        this.baseline.set(current);
        return;
      }
      if (occurrence) {
        await firstValueFrom(
          this.meetingService.updateOccurrence(this.data.meetingId, occurrence.occurrence_id, {
            start_time: occurrence.start_time,
            // A zero or missing duration inherits the series' (the API requires one), as the composer reads it.
            duration: occurrence.duration || fresh.duration,
            description,
          })
        );
      } else {
        await firstValueFrom(this.meetingService.updateMeeting(this.data.meetingId, buildMeetingUpdateRequest(fresh, { description })));
      }
      this.data.onApplied(description);
      this.messageService.add({ severity: 'success', summary: 'Agenda saved', detail: 'The agenda has been updated.' });
      this.ref.close();
    } catch (error) {
      console.error('Failed to save the meeting agenda', this.data.meetingId, error);
      this.failed.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  /** Keep the newer agenda someone else saved: the page shows it and the dialog closes. */
  protected useTheirs(): void {
    this.data.onApplied(this.conflict() ?? '');
    this.ref.close();
  }

  protected close(): void {
    if (!this.saving()) {
      this.ref.close();
    }
  }

  /**
   * The occurrence this dialog edits, as the fresh record holds it; `null` for a series edit. Matched by
   * its start instant as well as its id: the page's payload and the authenticated read need not spell
   * the id alike (seconds or milliseconds), but they agree on when it starts. A cancelled one counts as
   * missing.
   */
  private freshOccurrence(meeting: Meeting): MeetingOccurrence | null {
    const edited = this.data.scope === 'occurrence' ? this.data.occurrence : null;
    if (!edited) {
      return null;
    }
    const startMs = Date.parse(edited.startTime);
    const match = (meeting.occurrences ?? []).find(
      (occurrence) => occurrence.occurrence_id === edited.occurrenceId || Date.parse(occurrence.start_time) === startMs
    );
    // Cancelled meanwhile (either signal): as good as gone, nothing to save to.
    return match && !isMeetingOccurrenceCancelled(match, meeting.cancelled_occurrences) ? match : null;
  }
}
