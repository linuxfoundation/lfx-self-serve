// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, effect, inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { MAX_CUSTOM_DURATION, MEETING_AGENDA_MAX_LENGTH, MIN_CUSTOM_DURATION, YOUTUBE_MAX_MEETING_TITLE_LENGTH } from '@lfx-one/shared/constants';
import { Meeting, MeetingOccurrence, MeetingRescheduleOccurrenceResult, UpdateMeetingOccurrenceRequest } from '@lfx-one/shared/interfaces';
import {
  combineDateTime,
  formatTo12HourInTimezone,
  getLongTimezoneName,
  getUserTimezone,
  toZonedDateCarrier,
  wallTimeExistsInTimezone,
} from '@lfx-one/shared/utils';
import { futureDateTimeValidator, timeFormatValidator } from '@lfx-one/shared/validators';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { map, startWith } from 'rxjs';

@Component({
  selector: 'lfx-reschedule-occurrence-dialog',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    CalendarComponent,
    InputNumberComponent,
    InputTextComponent,
    MessageComponent,
    TextareaComponent,
    TimePickerComponent,
    MeetingTimePipe,
  ],
  templateUrl: './reschedule-occurrence-dialog.component.html',
})
export class RescheduleOccurrenceDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly meeting: Meeting = this.config.data.meeting;
  public readonly occurrence: MeetingOccurrence = this.config.data.occurrence;
  // The occurrence endpoint takes no timezone, so the new time is always read in the series' own zone.
  public readonly timezone: string = this.meeting.timezone || getUserTimezone();
  public readonly minDuration = MIN_CUSTOM_DURATION;
  public readonly maxDuration = MAX_CUSTOM_DURATION;
  public readonly agendaMaxLength = MEETING_AGENDA_MAX_LENGTH;
  // YouTube uploads title the video from the meeting, so the series' shorter cap applies here too.
  public readonly titleMaxLength: number | null = this.meeting.youtube_upload_enabled ? YOUTUBE_MAX_MEETING_TITLE_LENGTH : null;
  // What the occurrence shows today: its own override if it has one, else the series value.
  private readonly initialTitle: string = this.occurrence.title || this.meeting.title || '';
  private readonly initialDescription: string = this.occurrence.description ?? this.meeting.description ?? '';
  // The picker shows the series' local calendar, so "today" has to be today in that zone, not the viewer's.
  public readonly minDate: Date = this.initMinDate();
  public readonly form: FormGroup = this.initializeForm();

  public readonly isSaving = signal(false);
  public readonly errorMessage = signal<string | null>(null);

  private readonly formRevision: Signal<number> = this.initFormRevision();
  public readonly newStartTime: Signal<string> = this.initNewStartTime();
  public readonly timezoneLabel: Signal<string> = this.initTimezoneLabel();
  public readonly isUnchanged: Signal<boolean> = this.initIsUnchanged();
  public readonly showFutureError: Signal<boolean> = this.initShowFutureError();
  public readonly showNonexistentTimeError: Signal<boolean> = this.initShowNonexistentTimeError();
  public readonly showTimeFormatError: Signal<boolean> = this.initShowTimeFormatError();
  public readonly showDurationError: Signal<boolean> = this.initShowDurationError();
  public readonly showTitleError: Signal<boolean> = this.initShowTitleError();
  public readonly showAgendaError: Signal<boolean> = this.initShowAgendaError();
  public readonly canSave: Signal<boolean> = this.initCanSave();

  public constructor() {
    // Closing mid-save would drop the result, so the parent never refreshes onto the new time.
    effect(() => {
      this.config.closable = !this.isSaving();
    });
  }

  public onCancel(): void {
    const result: MeetingRescheduleOccurrenceResult = { confirmed: false };
    this.dialogRef.close(result);
  }

  public onConfirm(): void {
    this.form.markAllAsTouched();
    if (!this.canSave()) {
      return;
    }

    const startTime = this.newStartTime();
    const payload: UpdateMeetingOccurrenceRequest = { start_time: startTime, duration: Number(this.form.get('duration')?.value) };
    const title = this.trimmedValue('title');
    if (title !== this.initialTitle.trim()) {
      payload.title = title;
    }
    const description = this.trimmedValue('description');
    if (description !== this.initialDescription.trim()) {
      payload.description = description;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    this.meetingService
      .updateOccurrence(this.meeting.id, this.occurrence.occurrence_id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          const result: MeetingRescheduleOccurrenceResult = { confirmed: true, start_time: startTime };
          this.dialogRef.close(result);
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.errorMessage.set(this.describeError(error));
        },
      });
  }

  private initializeForm(): FormGroup {
    const occurrenceStart = new Date(this.occurrence.start_time);

    const form = new FormGroup(
      {
        startDate: new FormControl<Date | null>(toZonedDateCarrier(occurrenceStart, this.timezone), [Validators.required]),
        startTime: new FormControl(formatTo12HourInTimezone(occurrenceStart, this.timezone), [Validators.required, timeFormatValidator()]),
        duration: new FormControl<number | null>(this.occurrence.duration, [
          Validators.required,
          Validators.min(MIN_CUSTOM_DURATION),
          Validators.max(MAX_CUSTOM_DURATION),
          Validators.pattern(/^\d+$/),
        ]),
        title: new FormControl(this.initialTitle, [
          Validators.required,
          Validators.pattern(/\S/),
          ...(this.titleMaxLength ? [Validators.maxLength(this.titleMaxLength)] : []),
        ]),
        // Upstream drops an empty agenda, so one that exists can be changed but not cleared.
        description: new FormControl(this.initialDescription, [
          Validators.maxLength(MEETING_AGENDA_MAX_LENGTH),
          ...(this.initialDescription.trim() ? [Validators.required, Validators.pattern(/\S/)] : []),
        ]),
        // Not user-editable; present only because `futureDateTimeValidator` reads the zone off the group.
        timezone: new FormControl(this.timezone),
      },
      { validators: [futureDateTimeValidator(), this.wallTimeExistsValidator()] }
    );

    // An occurrence created elsewhere can carry a duration outside what this form accepts; show why
    // Save is disabled up front instead of waiting for the organizer to touch a field they didn't change.
    const duration = form.get('duration');
    if (duration?.invalid) {
      duration.markAsTouched();
    }

    return form;
  }

  /**
   * Rejects a wall-clock time that falls in the series zone's spring-forward gap.
   * @description `combineDateTime` silently normalizes such a time (2:30 AM on a spring-forward day
   * becomes 3:30 AM), so it would pass the future check and move the occurrence to an instant the
   * organizer never picked.
   */
  private wallTimeExistsValidator(): ValidatorFn {
    return (group: AbstractControl): ValidationErrors | null => {
      const startDate: Date | null = group.get('startDate')?.value;
      const startTime: string | null = group.get('startTime')?.value;
      if (!startDate || !startTime || group.get('startTime')?.invalid) {
        return null;
      }
      return wallTimeExistsInTimezone(startDate, startTime, this.timezone) ? null : { nonexistentWallTime: true };
    };
  }

  private initMinDate(): Date {
    const carrier = toZonedDateCarrier(new Date(), this.timezone);
    carrier.setHours(0, 0, 0, 0);
    return carrier;
  }

  private initFormRevision(): Signal<number> {
    let revision = 0;
    return toSignal(
      this.form.events.pipe(
        map(() => ++revision),
        startWith(0)
      ),
      { initialValue: 0 }
    );
  }

  private initNewStartTime(): Signal<string> {
    return computed(() => {
      this.formRevision();
      const { startDate, startTime } = this.form.getRawValue();
      return startDate && startTime ? combineDateTime(startDate, startTime, this.timezone) : '';
    });
  }

  // Standard vs daylight naming depends on the instant, so it follows the proposed start, not the original.
  private initTimezoneLabel(): Signal<string> {
    return computed(() => getLongTimezoneName(this.newStartTime() || this.occurrence.start_time, this.timezone) || this.timezone);
  }

  private initIsUnchanged(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      const start = this.newStartTime();
      return (
        !!start &&
        new Date(start).getTime() === new Date(this.occurrence.start_time).getTime() &&
        Number(this.form.get('duration')?.value) === this.occurrence.duration &&
        this.trimmedValue('title') === this.initialTitle.trim() &&
        this.trimmedValue('description') === this.initialDescription.trim()
      );
    });
  }

  private initShowFutureError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      return !!this.form.errors?.['futureDateTime'] && this.isStartTouched();
    });
  }

  private initShowNonexistentTimeError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      return !!this.form.errors?.['nonexistentWallTime'] && this.isStartTouched();
    });
  }

  private initShowTimeFormatError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      const control = this.form.get('startTime');
      return !!control?.touched && !!control.errors?.['invalidTimeFormat'];
    });
  }

  private initShowDurationError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      const control = this.form.get('duration');
      return !!control?.touched && control.invalid;
    });
  }

  private initShowTitleError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      const control = this.form.get('title');
      return !!control?.touched && control.invalid;
    });
  }

  private initShowAgendaError(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      const control = this.form.get('description');
      return !!control?.touched && control.invalid;
    });
  }

  private initCanSave(): Signal<boolean> {
    return computed(() => {
      this.formRevision();
      return this.form.valid && !!this.newStartTime() && !this.isUnchanged() && !this.isSaving();
    });
  }

  private trimmedValue(control: 'title' | 'description'): string {
    return String(this.form.get(control)?.value ?? '').trim();
  }

  private isStartTouched(): boolean {
    return !!(this.form.get('startDate')?.touched || this.form.get('startTime')?.touched);
  }

  private describeError(error: HttpErrorResponse): string {
    if (error.status === 400) {
      const upstreamMessage = error.error?.message ?? error.error?.error;
      return typeof upstreamMessage === 'string' && upstreamMessage
        ? upstreamMessage
        : 'These changes could not be saved for the occurrence. Please review them and try again.';
    }
    if (error.status === 403) {
      return 'You do not have permission to edit this occurrence.';
    }
    if (error.status === 404) {
      return 'This occurrence no longer exists. Please refresh the page.';
    }
    if (error.status === 0) {
      return 'Network error. Please check your connection and try again.';
    }
    return 'Failed to update the occurrence. Please try again.';
  }
}
