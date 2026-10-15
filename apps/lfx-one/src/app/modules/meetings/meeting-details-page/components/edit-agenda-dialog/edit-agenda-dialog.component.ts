// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MEETING_AGENDA_MAX_LENGTH, MEETING_AGENDA_WARNING_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingEditAgendaDialogData, MeetingEditAgendaDialogResult } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
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
 * upstream API has no version or ETag): if the agenda changed since the dialog opened, the dialog shows
 * the newer one and asks, rather than overwriting it. It is also the body of a series save, which
 * replaces the whole meeting: built from that full record with only the agenda changed, never from the
 * page's public payload, which lacks fields a save must keep. A save in the moment between that read and
 * the write would still win; the API offers nothing narrower.
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
  protected readonly failed = signal(false);

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
    () => !this.saving() && this.value().trim() !== this.data.original && this.length() <= MEETING_AGENDA_MAX_LENGTH && !this.emptyOccurrence()
  );

  protected async save(force = false): Promise<void> {
    if (!force && !this.canSave()) {
      return;
    }
    const description = this.value().trim();
    this.saving.set(true);
    this.failed.set(false);
    try {
      const fresh = await firstValueFrom(this.meetingService.getMeetingDetail(this.data.meetingId, { skipCache: true }));
      const current = this.currentAgenda(fresh);
      if (!force && current !== this.data.original) {
        this.conflict.set(current);
        return;
      }
      if (this.data.scope === 'occurrence' && this.data.occurrence) {
        const { occurrenceId, startTime, duration } = this.data.occurrence;
        await firstValueFrom(this.meetingService.updateOccurrence(this.data.meetingId, occurrenceId, { start_time: startTime, duration, description }));
      } else {
        await firstValueFrom(this.meetingService.updateMeeting(this.data.meetingId, { ...fresh, description }));
      }
      this.messageService.add({ severity: 'success', summary: 'Agenda saved', detail: 'The agenda has been updated.' });
      this.ref.close({ description } satisfies MeetingEditAgendaDialogResult);
    } catch {
      this.failed.set(true);
    } finally {
      this.saving.set(false);
    }
  }

  /** Keep the newer agenda someone else saved: the dialog closes and the page shows it. */
  protected useTheirs(): void {
    this.ref.close({ description: this.conflict() ?? '' } satisfies MeetingEditAgendaDialogResult);
  }

  protected close(): void {
    this.ref.close();
  }

  /** The agenda this dialog edits, as the fresh record holds it, trimmed. */
  private currentAgenda(meeting: Meeting): string {
    if (this.data.scope === 'occurrence' && this.data.occurrence) {
      const occurrenceId = this.data.occurrence.occurrenceId;
      return (meeting.occurrences ?? []).find((occurrence) => occurrence.occurrence_id === occurrenceId)?.description?.trim() ?? '';
    }
    return meeting.description?.trim() ?? '';
  }
}
