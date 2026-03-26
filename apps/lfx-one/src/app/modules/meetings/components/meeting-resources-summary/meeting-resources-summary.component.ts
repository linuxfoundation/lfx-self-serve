// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-one/shared/constants';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { CustomRecurrencePattern, MeetingAttachment, PendingAttachment } from '@lfx-one/shared/interfaces';
import { buildRecurrenceSummary, generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'lfx-meeting-resources-summary',
  imports: [ReactiveFormsModule, FileUploadComponent, ButtonComponent],
  templateUrl: './meeting-resources-summary.component.html',
})
export class MeetingResourcesSummaryComponent implements OnInit {
  // 1. Private injections
  private readonly messageService = inject(MessageService);

  // 2. Public fields (inputs, outputs, constants)
  public readonly form = input.required<FormGroup>();
  public readonly existingAttachments = input<MeetingAttachment[]>([]);
  public readonly isEditMode = input<boolean>(false);
  public readonly deletingAttachmentId = input<string | null>(null);
  public readonly meetingId = input<string | null>(null);
  public readonly pendingAttachmentDeletions = input<string[]>([]);
  public readonly goToStep = output<number>();
  public readonly deleteAttachment = output<string>();
  public readonly undoDeleteAttachment = output<string>();
  public readonly deleteLinkAttachment = output<string>();
  public readonly acceptString = generateAcceptString();

  // 3. Simple WritableSignals
  public pendingAttachments = signal<PendingAttachment[]>([]);
  public newLinkTitle = signal('');
  public newLinkUrl = signal('');

  // 4. Complex computed/toSignal
  public readonly importantLinksFormArray = computed(() => this.form().get('important_links') as FormArray);
  public readonly pendingDeletionSet = computed(() => new Set(this.pendingAttachmentDeletions()));
  public readonly formattedDateTime = computed(() => this.formatDateTime());
  public readonly selectedFeatures = computed(() => this.getSelectedFeatures());
  public readonly meetingTypeLabel = computed(() => this.getMeetingTypeLabel());
  public readonly recurrenceLabel = computed(() => this.getRecurrenceLabel());

  public ngOnInit(): void {
    const existingAttachments = this.form().get('attachments')?.value || [];
    this.pendingAttachments.set(existingAttachments);
  }

  public getFileType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toUpperCase();
    return extension || 'FILE';
  }

  public onFileSelect(event: any): void {
    let files: File[] = [];
    if (event.files && Array.isArray(event.files)) {
      files = event.files;
    } else if (event.currentFiles && Array.isArray(event.currentFiles)) {
      files = event.currentFiles;
    } else {
      return;
    }

    if (!files || files.length === 0) return;

    const newAttachments = Array.from(files)
      .map((file) => {
        const validationError = this.validateFile(file);
        if (validationError) {
          this.messageService.add({
            severity: 'error',
            summary: 'File Upload Error',
            detail: validationError,
            life: 5000,
          });
          return null;
        }

        const pendingAttachment: PendingAttachment = {
          id: crypto.randomUUID(),
          fileName: file.name,
          file: file,
          fileSize: file.size,
          mimeType: file.type,
          uploading: false,
          uploaded: false,
        };

        return pendingAttachment;
      })
      .filter(Boolean) as PendingAttachment[];

    this.pendingAttachments.update((current) => [...current, ...newAttachments]);
    this.form().get('attachments')?.setValue(this.pendingAttachments());
  }

  public removeAttachment(id: string): void {
    this.pendingAttachments.update((current) => current.filter((f) => f.id !== id));
    this.form().get('attachments')?.setValue(this.pendingAttachments());
  }

  public addLink(): void {
    const title = this.newLinkTitle().trim();
    const url = this.newLinkUrl().trim();

    if (title && url) {
      const linkFormGroup = new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl(title),
        url: new FormControl(url),
        uid: new FormControl(null),
      });

      this.importantLinksFormArray().push(linkFormGroup);
      this.newLinkTitle.set('');
      this.newLinkUrl.set('');
    }
  }

  public removeLink(index: number): void {
    const linkControl = this.importantLinksFormArray().at(index);
    const uid = linkControl?.get('uid')?.value;

    if (uid) {
      this.deleteLinkAttachment.emit(uid);
    }

    this.importantLinksFormArray().removeAt(index);
  }

  public editStep(step: number): void {
    this.goToStep.emit(step);
  }

  public onDeleteExistingAttachment(attachmentId: string): void {
    this.deleteAttachment.emit(attachmentId);
  }

  private validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`;
    }

    if (!isFileTypeAllowed(file.type, file.name, ALLOWED_FILE_TYPES)) {
      const fileTypeDisplay = getMimeTypeDisplayName(file.type, file.name);
      const allowedTypes = getAcceptedFileTypesDisplay();
      return `File type "${fileTypeDisplay}" is not supported. Allowed types: ${allowedTypes}.`;
    }

    const currentFiles = this.pendingAttachments();
    const isDuplicate = currentFiles.some((attachment) => attachment.fileName === file.name && !attachment.uploadError);

    if (isDuplicate) {
      return `A file named "${file.name}" has already been selected for upload.`;
    }

    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `Invalid filename "${file.name}". Filename cannot contain path traversal characters or start with a dot.`;
    }

    return null;
  }

  private formatDateTime(): string {
    const startDate = this.form().get('startDate')?.value;
    const startTime = this.form().get('startTime')?.value;
    const timezone = this.form().get('timezone')?.value;

    if (!startDate || !startTime) {
      return 'Not set';
    }

    const date = new Date(startDate);
    const formattedDate = date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `${formattedDate} at ${startTime} (${timezone})`;
  }

  private getSelectedFeatures(): string[] {
    const form = this.form();
    const features: string[] = [];

    if (form.get('recording_enabled')?.value) features.push('Recording');
    if (form.get('transcript_enabled')?.value) features.push('Transcripts');
    if (form.get('youtube_upload_enabled')?.value) features.push('YouTube Upload');
    if (form.get('show_meeting_attendees')?.value ?? false) features.push('Show Attendees');
    if (form.get('zoom_ai_enabled')?.value) features.push('AI Summary');

    return features;
  }

  private getMeetingTypeLabel(): string {
    const meetingType = this.form().get('meeting_type')?.value;
    if (!meetingType) return 'Not selected';

    return meetingType
      .split('_')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private getRecurrenceLabel(): string {
    const recurrenceType = this.form().get('recurrenceType')?.value;
    if (!recurrenceType || recurrenceType === 'none') {
      return 'One-time meeting';
    }

    if (recurrenceType === 'custom') {
      const recurrenceObject = this.form().get('recurrence')?.value;
      if (recurrenceObject && recurrenceObject.type) {
        const customPattern = this.convertToCustomPattern(recurrenceObject);
        const summary = buildRecurrenceSummary(customPattern);
        return summary.fullSummary;
      }
      return 'Custom recurrence pattern';
    }

    const labels: Record<string, string> = {
      daily: 'Daily',
      weekly: 'Weekly',
      weekdays: 'Every weekday',
      monthly_nth: 'Monthly',
      monthly_last: 'Monthly',
    };

    return labels[recurrenceType] || 'Custom';
  }

  private convertToCustomPattern(recurrenceObject: any): CustomRecurrencePattern {
    let patternType: 'daily' | 'weekly' | 'monthly' = 'weekly';
    if (recurrenceObject.type === RecurrenceType.DAILY) patternType = 'daily';
    else if (recurrenceObject.type === RecurrenceType.WEEKLY) patternType = 'weekly';
    else if (recurrenceObject.type === RecurrenceType.MONTHLY) patternType = 'monthly';

    let monthlyType: 'dayOfMonth' | 'dayOfWeek' = 'dayOfMonth';
    if (recurrenceObject.monthly_day) monthlyType = 'dayOfMonth';
    else if (recurrenceObject.monthly_week && recurrenceObject.monthly_week_day) monthlyType = 'dayOfWeek';

    let endType: 'never' | 'date' | 'occurrences' = 'never';
    if (recurrenceObject.end_date_time) endType = 'date';
    else if (recurrenceObject.end_times) endType = 'occurrences';

    let weeklyDaysArray: number[] = [];
    if (recurrenceObject.weekly_days) {
      weeklyDaysArray = recurrenceObject.weekly_days.split(',').map((d: string) => parseInt(d.trim()) - 1);
    }

    return {
      ...recurrenceObject,
      patternType,
      weeklyDaysArray,
      monthlyType,
      endType,
    };
  }
}
