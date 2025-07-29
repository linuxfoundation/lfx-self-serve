// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { CalendarComponent } from '@app/shared/components/calendar/calendar.component';
import { InputTextComponent } from '@app/shared/components/input-text/input-text.component';
import { SelectComponent } from '@app/shared/components/select/select.component';
import { TextareaComponent } from '@app/shared/components/textarea/textarea.component';
import { TimePickerComponent } from '@app/shared/components/time-picker/time-picker.component';
import { ToggleComponent } from '@app/shared/components/toggle/toggle.component';
import { MeetingService } from '@app/shared/services/meeting.service';
import { ProjectService } from '@app/shared/services/project.service';
import { getUserTimezone, TIMEZONES } from '@lfx-pcc/shared/constants';
import { MeetingType, MeetingVisibility, RecurrenceType } from '@lfx-pcc/shared/enums';
import { CreateMeetingRequest, MeetingRecurrence } from '@lfx-pcc/shared/interfaces';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-meeting-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    CalendarComponent,
    InputTextComponent,
    SelectComponent,
    TextareaComponent,
    TimePickerComponent,
    ToggleComponent,
    TooltipModule,
  ],
  templateUrl: './meeting-form.component.html',
  styleUrl: './meeting-form.component.scss',
})
export class MeetingFormComponent {
  private readonly config = inject(DynamicDialogConfig);
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly meetingService = inject(MeetingService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);

  // Loading state for form submissions
  public submitting = signal<boolean>(false);

  // Create form group internally
  public form = signal<FormGroup>(this.createMeetingFormGroup());
  public loading = signal<boolean>(false);

  public isEditing = computed(() => this.config.data?.isEditing || false);
  public meetingId = computed(() => this.config.data?.meetingId);
  public meeting = computed(() => this.config.data?.meeting);

  // Duration options for the select dropdown
  public durationOptions = [
    { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 },
    { label: '60 minutes', value: 60 },
    { label: '90 minutes', value: 90 },
    { label: '120 minutes', value: 120 },
    { label: 'Custom...', value: 'custom' },
  ];

  // Meeting type options (using shared enum)
  public meetingTypeOptions = [
    { label: 'Board', value: MeetingType.BOARD },
    { label: 'Maintainers', value: MeetingType.MAINTAINERS },
    { label: 'Marketing', value: MeetingType.MARKETING },
    { label: 'Technical', value: MeetingType.TECHNICAL },
    { label: 'Legal', value: MeetingType.LEGAL },
    { label: 'Other', value: MeetingType.OTHER },
    { label: 'None', value: MeetingType.NONE },
  ];

  // Visibility options
  public visibilityOptions = [
    { label: 'Public', value: MeetingVisibility.PUBLIC },
    { label: 'Private', value: MeetingVisibility.PRIVATE },
    { label: 'Restricted', value: MeetingVisibility.RESTRICTED },
  ];

  // Timezone options from shared constants
  public timezoneOptions = TIMEZONES.map((tz) => ({
    label: `${tz.label} (${tz.offset})`,
    value: tz.value,
  }));

  // AI Summary Access options
  public aiSummaryAccessOptions = [
    { label: 'PCC', value: 'PCC' },
    { label: 'PCC & Individuals', value: 'PCC & Individuals' },
  ];

  // Recurrence options (computed dynamically based on selected date)
  public recurrenceOptions = signal([
    { label: 'Does not repeat', value: 'none' },
    { label: 'Daily', value: 'daily' },
    { label: 'Weekly on Monday', value: 'weekly' }, // Will be updated dynamically
    { label: 'Monthly on the 1st Monday', value: 'monthly_nth' }, // Will be updated dynamically
    { label: 'Monthly on the last Monday', value: 'monthly_last' }, // Will be updated dynamically
    { label: 'Every weekday', value: 'weekdays' },
  ]);

  // Minimum date (yesterday)
  public minDate = signal<Date>(this.getYesterday());

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  // Public methods
  public onSubmit(): void {
    // Mark all form controls as touched and dirty to show validation errors
    Object.keys(this.form().controls).forEach((key) => {
      const control = this.form().get(key);
      control?.markAsTouched();
      control?.markAsDirty();
    });

    if (this.form().invalid) {
      return;
    }

    const project = this.projectService.project();
    if (!project) {
      this.messageService.add({
        severity: 'error',
        summary: 'Error',
        detail: 'Project information is required to create a meeting.',
      });
      return;
    }

    this.submitting.set(true);
    const formValue = this.form().value;

    // Process duration value
    const duration = formValue.duration === 'custom' ? formValue.customDuration : formValue.duration;

    // Combine date and time for start_time
    const startDateTime = this.combineDateTime(formValue.startDate, formValue.startTime);

    // Generate recurrence object if needed
    const recurrenceObject = this.generateRecurrenceObject(formValue.recurrence, formValue.startDate);

    // Create meeting data using CreateMeetingRequest interface
    const meetingData: CreateMeetingRequest = {
      project_id: project.id,
      topic: formValue.topic,
      agenda: formValue.agenda || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type || 'None',
      early_join_time: formValue.early_join_time || 10,
      visibility: formValue.show_in_public_calendar ? MeetingVisibility.PUBLIC : MeetingVisibility.PRIVATE,
      recording_enabled: formValue.recording_enabled || false,
      transcripts_enabled: formValue.transcripts_enabled || false,
      youtube_enabled: formValue.youtube_enabled || false,
      zoom_ai_enabled: formValue.zoom_ai_enabled || false,
      require_ai_summary_approval: formValue.require_ai_summary_approval || false,
      ai_summary_access: formValue.ai_summary_access || 'PCC',
      recurrence: recurrenceObject,
    };

    const operation = this.isEditing() ? this.meetingService.updateMeeting(this.meetingId()!, meetingData) : this.meetingService.createMeeting(meetingData);

    operation.subscribe({
      next: (meeting) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `Meeting ${this.isEditing() ? 'updated' : 'created'} successfully`,
        });
        this.dialogRef.close(meeting);
      },
      error: (error) => {
        console.error('Error saving meeting:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditing() ? 'update' : 'create'} meeting. Please try again.`,
        });
        this.submitting.set(false);
      },
    });
  }

  public onCancel(): void {
    this.dialogRef.close();
  }

  // Private methods
  private combineDateTime(date: Date, time: string): string {
    if (!date || !time) return '';

    // Parse the 12-hour format time (e.g., "12:45 AM" or "1:30 PM")
    const match = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) {
      console.error('Invalid time format:', time);
      return '';
    }

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const period = match[3].toUpperCase();

    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) {
      hours += 12;
    } else if (period === 'AM' && hours === 12) {
      hours = 0;
    }

    // Create a new date object with the selected date and time
    const combinedDate = new Date(date);
    combinedDate.setHours(hours, minutes, 0, 0);

    // Return ISO string
    return combinedDate.toISOString();
  }

  private createMeetingFormGroup(): FormGroup {
    const defaultDateTime = this.getDefaultStartDateTime();

    return new FormGroup(
      {
        // Basic info (using exact database field names)
        topic: new FormControl('', [Validators.required]),
        agenda: new FormControl(''),
        meeting_type: new FormControl(''),

        // Date/Time fields (helper fields for form, will be combined into start_time)
        startDate: new FormControl(defaultDateTime.date, [Validators.required]),
        startTime: new FormControl(defaultDateTime.time, [Validators.required]),
        duration: new FormControl(60, [Validators.required]),
        customDuration: new FormControl(''),
        timezone: new FormControl(getUserTimezone(), [Validators.required]),
        early_join_time: new FormControl(10, [Validators.min(10), Validators.max(60)]),

        // Meeting settings (using exact database field names)
        show_in_public_calendar: new FormControl(false),
        recording_enabled: new FormControl(false),
        transcripts_enabled: new FormControl(false),
        youtube_enabled: new FormControl(false),
        zoom_ai_enabled: new FormControl(false),
        require_ai_summary_approval: new FormControl(false),
        ai_summary_access: new FormControl('PCC'),

        // Recurrence settings
        recurrence: new FormControl('none'),
      },
      { validators: this.futureDateTimeValidator() }
    );
  }

  private getYesterday(): Date {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  }

  private getDefaultStartDateTime(): { date: Date; time: string } {
    const now = new Date();
    // Add 1 hour to current time
    now.setHours(now.getHours() + 1);

    // Round up to next 15 minutes
    const minutes = now.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    now.setMinutes(roundedMinutes);
    now.setSeconds(0);
    now.setMilliseconds(0);

    // If rounding pushed us to next hour, adjust accordingly
    if (roundedMinutes === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    }

    // Format time to 12-hour format (HH:MM AM/PM)
    const hours = now.getHours();
    const mins = now.getMinutes();
    const period = hours >= 12 ? 'PM' : 'AM';
    let displayHours = hours > 12 ? hours - 12 : hours;
    if (displayHours === 0) {
      displayHours = 12;
    }
    const timeString = `${displayHours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${period}`;

    return {
      date: new Date(now),
      time: timeString,
    };
  }

  private futureDateTimeValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const formGroup = control as FormGroup;
      const startDate = formGroup.get('startDate')?.value;
      const startTime = formGroup.get('startTime')?.value;
      const timezone = formGroup.get('timezone')?.value;

      if (!startDate || !startTime || !timezone) {
        return null; // Don't validate if values are not set
      }

      // Combine the date and time
      const combinedDateTime = this.combineDateTime(startDate, startTime);
      if (!combinedDateTime) {
        return null; // Invalid time format
      }

      // Parse the combined datetime
      const selectedDate = new Date(combinedDateTime);

      // Get current time in the selected timezone
      const now = new Date();

      // Create timezone-aware date strings for comparison
      const selectedTimeString = selectedDate.toLocaleString('en-US', { timeZone: timezone });
      const currentTimeString = now.toLocaleString('en-US', { timeZone: timezone });

      // Convert back to Date objects for comparison
      const selectedTimeInZone = new Date(selectedTimeString);
      const currentTimeInZone = new Date(currentTimeString);

      // Check if the selected time is in the future
      if (selectedTimeInZone <= currentTimeInZone) {
        return { futureDateTime: true };
      }

      return null;
    };
  }

  private updateRecurrenceOptions(date: Date): void {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[date.getDay()];

    // Calculate which occurrence of the day in the month (1st, 2nd, 3rd, 4th, or last)
    const { weekOfMonth, isLastWeek } = this.getWeekOfMonth(date);
    const ordinals = ['', '1st', '2nd', '3rd', '4th'];
    const ordinal = ordinals[weekOfMonth] || `${weekOfMonth}th`;

    const options = [
      { label: 'Does not repeat', value: 'none' },
      { label: 'Daily', value: 'daily' },
      { label: `Weekly on ${dayName}`, value: 'weekly' },
      { label: 'Every weekday', value: 'weekdays' },
    ];

    // If this is the last occurrence, show "Monthly on the last [day]" instead of "Monthly on the Nth [day]"
    if (isLastWeek) {
      options.splice(3, 0, { label: `Monthly on the last ${dayName}`, value: 'monthly_last' });
    } else {
      options.splice(3, 0, { label: `Monthly on the ${ordinal} ${dayName}`, value: 'monthly_nth' });
    }

    this.recurrenceOptions.set(options);
  }

  private getWeekOfMonth(date: Date): { weekOfMonth: number; isLastWeek: boolean } {
    // Find the first occurrence of this day of week in the month
    const targetDayOfWeek = date.getDay();
    let firstOccurrence = 1;
    while (new Date(date.getFullYear(), date.getMonth(), firstOccurrence).getDay() !== targetDayOfWeek) {
      firstOccurrence++;
    }

    // Calculate which week this date is in
    const weekOfMonth = Math.floor((date.getDate() - firstOccurrence) / 7) + 1;

    // Check if this is the last occurrence of this day in the month
    const nextWeekDate = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
    const isLastWeek = nextWeekDate.getMonth() !== date.getMonth();

    return { weekOfMonth, isLastWeek };
  }

  private generateRecurrenceObject(recurrenceType: string, startDate: Date): MeetingRecurrence | undefined {
    if (recurrenceType === 'none') {
      return undefined;
    }

    const dayOfWeek = startDate.getDay() + 1; // Zoom API uses 1-7 (Sunday=1)
    const { weekOfMonth } = this.getWeekOfMonth(startDate);

    switch (recurrenceType) {
      case 'daily':
        return {
          type: RecurrenceType.DAILY,
          repeat_interval: 1,
        };

      case 'weekly':
        return {
          type: RecurrenceType.WEEKLY,
          repeat_interval: 1,
          weekly_days: dayOfWeek.toString(),
        };

      case 'monthly_nth':
        return {
          type: RecurrenceType.MONTHLY,
          repeat_interval: 1,
          monthly_week: weekOfMonth,
          monthly_week_day: dayOfWeek,
        };

      case 'monthly_last':
        return {
          type: RecurrenceType.MONTHLY,
          repeat_interval: 1,
          monthly_week: -1,
          monthly_week_day: dayOfWeek,
        };

      case 'weekdays':
        return {
          type: RecurrenceType.WEEKLY,
          repeat_interval: 1,
          weekly_days: '2,3,4,5,6', // Monday through Friday
        };

      default:
        return undefined;
    }
  }

  private initializeForm(): void {
    if (this.isEditing() && this.meeting()) {
      const meeting = this.meeting()!;

      // Parse start_time to separate date and time
      let startDate = null;
      let startTime = '';

      if (meeting.start_time) {
        const date = new Date(meeting.start_time);
        startDate = date;

        // Update recurrence options based on the meeting date
        this.updateRecurrenceOptions(date);

        // Convert to 12-hour format for display
        const hours = date.getHours();
        const minutes = date.getMinutes();
        const period = hours >= 12 ? 'PM' : 'AM';
        let displayHours = hours > 12 ? hours - 12 : hours;
        if (displayHours === 0) {
          displayHours = 12;
        }
        startTime = `${displayHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${period}`;
      }

      // Map recurrence object back to form value
      let recurrenceValue = 'none';
      if (meeting.recurrence) {
        const rec = meeting.recurrence;
        if (rec.type === RecurrenceType.DAILY) {
          recurrenceValue = 'daily';
        } else if (rec.type === RecurrenceType.WEEKLY) {
          recurrenceValue = rec.weekly_days === '2,3,4,5,6' ? 'weekdays' : 'weekly';
        } else if (rec.type === RecurrenceType.MONTHLY) {
          recurrenceValue = rec.monthly_week === -1 ? 'monthly_last' : 'monthly_nth';
        }
      }

      this.form().patchValue({
        topic: meeting.topic || '',
        agenda: meeting.agenda || '',
        meeting_type: meeting.meeting_type || 'None',
        startDate: startDate,
        startTime: startTime,
        duration: meeting.duration || 60,
        timezone: meeting.timezone || getUserTimezone(),
        early_join_time: meeting.early_join_time || 10,
        show_in_public_calendar: meeting.show_in_public_calendar || false,
        recording_enabled: meeting.recording_enabled || false,
        transcripts_enabled: meeting.transcripts_enabled || false,
        youtube_enabled: meeting.youtube_enabled || false,
        zoom_ai_enabled: meeting.zoom_ai_enabled || false,
        require_ai_summary_approval: meeting.require_ai_summary_approval || false,
        ai_summary_access: meeting.ai_summary_access || 'PCC',
        recurrence: recurrenceValue,
      });
    } else {
      // For new meetings, update recurrence options based on default date
      const defaultDateTime = this.getDefaultStartDateTime();
      this.updateRecurrenceOptions(defaultDateTime.date);
    }

    // Add custom duration validator when duration is 'custom'
    this.form()
      .get('duration')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const customDurationControl = this.form().get('customDuration');
        if (value === 'custom') {
          customDurationControl?.setValidators([Validators.required, Validators.min(5), Validators.max(480)]);
        } else {
          customDurationControl?.clearValidators();
        }
        customDurationControl?.updateValueAndValidity();
      });

    // Update recurrence options when start date changes
    this.form()
      .get('startDate')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((date) => {
        if (date) {
          this.updateRecurrenceOptions(date);
          // Reset recurrence selection to 'none' when date changes
          this.form().get('recurrence')?.setValue('none');
        }
      });
  }
}
