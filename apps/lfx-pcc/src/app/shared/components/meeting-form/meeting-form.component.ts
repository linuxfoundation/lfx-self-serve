// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { CalendarComponent } from '@app/shared/components/calendar/calendar.component';
import { InputTextComponent } from '@app/shared/components/input-text/input-text.component';
import { SelectComponent } from '@app/shared/components/select/select.component';
import { TextareaComponent } from '@app/shared/components/textarea/textarea.component';
import { TimePickerComponent } from '@app/shared/components/time-picker/time-picker.component';
import { ToggleComponent } from '@app/shared/components/toggle/toggle.component';
import { MeetingService } from '@app/shared/services/meeting.service';
import { ProjectService } from '@app/shared/services/project.service';
import { CreateMeetingRequest, MeetingType, MeetingVisibility } from '@lfx-pcc/shared/interfaces';
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

  // Timezone options (common timezones)
  public timezoneOptions = [
    { label: 'UTC', value: 'UTC' },
    { label: 'America/New_York (EST/EDT)', value: 'America/New_York' },
    { label: 'America/Chicago (CST/CDT)', value: 'America/Chicago' },
    { label: 'America/Denver (MST/MDT)', value: 'America/Denver' },
    { label: 'America/Los_Angeles (PST/PDT)', value: 'America/Los_Angeles' },
    { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
    { label: 'Europe/Paris (CET/CEST)', value: 'Europe/Paris' },
    { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
    { label: 'Asia/Shanghai (CST)', value: 'Asia/Shanghai' },
    { label: 'Australia/Sydney (AEST/AEDT)', value: 'Australia/Sydney' },
  ];

  // AI Summary Access options
  public aiSummaryAccessOptions = [
    { label: 'PCC', value: 'PCC' },
    { label: 'PCC & Individuals', value: 'PCC & Individuals' },
  ];

  public constructor() {
    // Initialize form with data when component is created
    this.initializeForm();
  }

  // Public methods
  public onSubmit(): void {
    if (this.form().invalid) {
      this.form().markAllAsTouched();
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

    // Create meeting data using CreateMeetingRequest interface
    const meetingData: CreateMeetingRequest = {
      project_id: project.id,
      topic: formValue.topic,
      agenda: formValue.agenda || '',
      start_time: startDateTime,
      duration: duration,
      timezone: formValue.timezone,
      meeting_type: formValue.meeting_type,
      early_join_time: formValue.early_join_time || 10,
      visibility: formValue.show_in_public_calendar ? MeetingVisibility.PUBLIC : MeetingVisibility.PRIVATE,
      recording_enabled: formValue.recording_enabled || false,
      transcripts_enabled: formValue.transcripts_enabled || false,
      youtube_enabled: formValue.youtube_enabled || false,
      zoom_ai_enabled: formValue.zoom_ai_enabled || false,
      require_ai_summary_approval: formValue.require_ai_summary_approval || false,
      ai_summary_access: formValue.ai_summary_access || 'PCC',
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
    return new FormGroup({
      // Basic info (using exact database field names)
      topic: new FormControl('', [Validators.required]),
      agenda: new FormControl(''),
      meeting_type: new FormControl('', [Validators.required]),

      // Date/Time fields (helper fields for form, will be combined into start_time)
      startDate: new FormControl(null, [Validators.required]),
      startTime: new FormControl('', [Validators.required]),
      duration: new FormControl(60, [Validators.required]),
      customDuration: new FormControl(''),
      timezone: new FormControl(this.getDefaultTimezone(), [Validators.required]),
      early_join_time: new FormControl(10, [Validators.min(10), Validators.max(60)]),

      // Meeting settings (using exact database field names)
      show_in_public_calendar: new FormControl(false),
      recording_enabled: new FormControl(false),
      transcripts_enabled: new FormControl(false),
      youtube_enabled: new FormControl(false),
      zoom_ai_enabled: new FormControl(false),
      require_ai_summary_approval: new FormControl(false),
      ai_summary_access: new FormControl('PCC'),
    });
  }

  private getDefaultTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
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
        startTime = date.toTimeString().slice(0, 5); // HH:MM format
      }

      this.form().patchValue({
        topic: meeting.topic || '',
        agenda: meeting.agenda || '',
        meeting_type: meeting.meeting_type || '',
        startDate: startDate,
        startTime: startTime,
        duration: meeting.duration || 60,
        timezone: meeting.timezone || this.getDefaultTimezone(),
        early_join_time: meeting.early_join_time || 5,
        show_in_public_calendar: meeting.show_in_public_calendar || false,
        recording_enabled: meeting.recording_enabled || false,
        transcripts_enabled: meeting.transcripts_enabled || false,
        youtube_enabled: meeting.youtube_enabled || false,
        zoom_ai_enabled: meeting.zoom_ai_enabled || false,
        require_ai_summary_approval: meeting.require_ai_summary_approval || false,
        ai_summary_access: meeting.ai_summary_access || 'PCC',
      });
    }

    // Add custom duration validator when duration is 'custom'
    this.form()
      .get('duration')
      ?.valueChanges.subscribe((value) => {
        const customDurationControl = this.form().get('customDuration');
        if (value === 'custom') {
          customDurationControl?.setValidators([Validators.required, Validators.min(5), Validators.max(480)]);
        } else {
          customDurationControl?.clearValidators();
        }
        customDurationControl?.updateValueAndValidity();
      });
  }
}
