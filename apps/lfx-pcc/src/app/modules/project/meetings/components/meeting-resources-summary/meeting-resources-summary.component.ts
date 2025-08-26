// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormArray, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_MB } from '@lfx-pcc/shared/constants';
import { MeetingAttachment, PendingAttachment } from '@lfx-pcc/shared/interfaces';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'lfx-meeting-resources-summary',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, FileUploadComponent, ButtonComponent, FileSizePipe],
  templateUrl: './meeting-resources-summary.component.html',
})
export class MeetingResourcesSummaryComponent implements OnInit {
  // Input from parent
  public readonly form = input.required<FormGroup>();
  public readonly existingAttachments = input<MeetingAttachment[]>([]);
  public readonly isEditMode = input<boolean>(false);
  public readonly deletingAttachmentId = input<string | null>(null);

  // File management
  public pendingAttachments = signal<PendingAttachment[]>([]);

  // New link for simple input approach (matching React code)
  public newLink = { title: '', url: '' };

  // Important links management
  public get importantLinksFormArray(): FormArray {
    return this.form().get('important_links') as FormArray;
  }

  // Summary computed values
  public formattedDateTime = computed(() => this.formatDateTime());
  public selectedFeatures = computed(() => this.getSelectedFeatures());
  public meetingTypeLabel = computed(() => this.getMeetingTypeLabel());
  public recurrenceLabel = computed(() => this.getRecurrenceLabel());

  // Inject services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);

  // Navigation
  public readonly goToStep = output<number>();
  public readonly deleteAttachment = output<string>();

  public constructor() {}

  public ngOnInit(): void {
    // Initialize attachments from form
    const existingAttachments = this.form().get('attachments')?.value || [];
    this.pendingAttachments.set(existingAttachments);
  }

  // Utility methods
  public getFileType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toUpperCase();
    return extension || 'FILE';
  }

  // File handling methods
  public onFileSelect(event: any): void {
    // Handle PrimeNG FileUpload event structure
    let files: File[] = [];
    if (event.files && Array.isArray(event.files)) {
      files = event.files;
    } else if (event.currentFiles && Array.isArray(event.currentFiles)) {
      files = event.currentFiles;
    } else {
      console.error('Could not extract files from PrimeNG FileUpload event:', event);
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
          fileUrl: '',
          fileSize: file.size,
          mimeType: file.type,
          uploading: true,
        };

        // Start the upload
        this.meetingService.uploadFileToStorage(file).subscribe({
          next: (result) => {
            this.pendingAttachments.update((current) =>
              current.map((pa) => (pa.id === pendingAttachment.id ? { ...pa, fileUrl: result.url, uploading: false } : pa))
            );
            this.form().get('attachments')?.setValue(this.pendingAttachments());
          },
          error: (error) => {
            this.pendingAttachments.update((current) =>
              current.map((pa) => (pa.id === pendingAttachment.id ? { ...pa, uploading: false, uploadError: error.message || 'Upload failed' } : pa))
            );
            console.error(`Failed to upload ${file.name}:`, error);
          },
        });

        return pendingAttachment;
      })
      .filter(Boolean) as PendingAttachment[];

    this.pendingAttachments.update((current) => [...current, ...newAttachments]);
  }

  public removeAttachment(id: string): void {
    this.pendingAttachments.update((current) => current.filter((f) => f.id !== id));
    this.form().get('attachments')?.setValue(this.pendingAttachments());
  }

  // Link management methods
  public addLink(): void {
    if (this.newLink.title && this.newLink.url) {
      const linkFormGroup = new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl(this.newLink.title),
        url: new FormControl(this.newLink.url),
      });

      this.importantLinksFormArray.push(linkFormGroup);
      this.newLink = { title: '', url: '' };
    }
  }

  public removeLink(index: number): void {
    this.importantLinksFormArray.removeAt(index);
  }

  // Navigation methods
  public editStep(step: number): void {
    this.goToStep.emit(step);
  }

  public onDeleteExistingAttachment(attachmentId: string): void {
    this.deleteAttachment.emit(attachmentId);
  }

  // Private methods
  private validateFile(file: File): string | null {
    // Check file size (10MB limit)
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File "${file.name}" is too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`;
    }

    // Check file type
    if (!ALLOWED_FILE_TYPES.includes(file.type as (typeof ALLOWED_FILE_TYPES)[number])) {
      const allowedTypes = ALLOWED_FILE_TYPES.map((type) => type.split('/')[1]).join(', ');
      return `File type "${file.type}" is not supported. Allowed types: ${allowedTypes}.`;
    }

    // Check for duplicate filenames in current session
    const currentFiles = this.pendingAttachments();
    const isDuplicate = currentFiles.some((attachment) => attachment.fileName === file.name && !attachment.uploadError);

    if (isDuplicate) {
      return `A file named "${file.name}" has already been selected for upload.`;
    }

    // Check filename safety
    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `Invalid filename "${file.name}". Filename cannot contain path traversal characters or start with a dot.`;
    }

    return null; // File is valid
  }

  // Summary formatting methods
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
    if (form.get('zoom_ai_enabled')?.value) features.push('AI Summary');

    return features;
  }

  private getMeetingTypeLabel(): string {
    const meetingType = this.form().get('meeting_type')?.value;
    if (!meetingType) return 'Not selected';

    // Convert to title case
    return meetingType
      .split('_')
      .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private getRecurrenceLabel(): string {
    const recurrence = this.form().get('recurrence')?.value;
    if (!recurrence || recurrence === 'none') {
      return 'One-time meeting';
    }

    const labels: { [key: string]: string } = {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
    };

    return labels[recurrence] || 'Custom';
  }
}
