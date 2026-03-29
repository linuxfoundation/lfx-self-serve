// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal, signal, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

@Component({
  selector: 'lfx-summary-modal',
  imports: [ButtonComponent, ReactiveFormsModule, TextareaComponent],
  templateUrl: './summary-modal.component.html',
})
export class SummaryModalComponent {
  // Injected services
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);

  // Inputs from dialog config
  private readonly summaryUid = this.dialogConfig.data.summaryUid as string;
  private readonly pastMeetingUid = this.dialogConfig.data.pastMeetingUid as string;
  public readonly meetingTitle = this.dialogConfig.data.meetingTitle as string;

  // Edit mode state
  public readonly isEditMode: WritableSignal<boolean> = signal(false);
  public readonly originalContent: WritableSignal<string> = signal(this.dialogConfig.data.summaryContent as string);
  public readonly isSaving: WritableSignal<boolean> = signal(false);
  public readonly isApproving: WritableSignal<boolean> = signal(false);
  public readonly isApproved: WritableSignal<boolean> = signal(this.dialogConfig.data.approved as boolean);
  private readonly wasUpdated: WritableSignal<boolean> = signal(false);

  // Reactive form for editing
  public readonly editForm: FormGroup = new FormGroup({
    content: new FormControl(this.dialogConfig.data.summaryContent as string),
  });

  // Sanitized HTML content for display
  public readonly summaryContent: Signal<SafeHtml> = computed(() => {
    const content = this.isEditMode() ? this.editForm.get('content')?.value : this.originalContent();
    return this.sanitizer.bypassSecurityTrustHtml(content || '');
  });

  // Public methods
  public enterEditMode(): void {
    this.editForm.get('content')?.setValue(this.originalContent() || '');
    this.isEditMode.set(true);
  }

  public cancelEdit(): void {
    this.editForm.get('content')?.setValue(this.originalContent() || '');
    this.isEditMode.set(false);
  }

  public saveEdit(): void {
    this.isSaving.set(true);
    const editedContent = this.editForm.get('content')?.value || '';

    this.meetingService
      .updatePastMeetingSummary(this.pastMeetingUid, this.summaryUid, { edited_content: editedContent })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Summary updated successfully',
          });
          // Update the original content with the saved changes
          this.originalContent.set(editedContent);
          this.wasUpdated.set(true);
          this.isSaving.set(false);
          this.isEditMode.set(false);
          // Keep modal open to show updated content
        },
        error: (error: unknown) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update summary',
          });
          this.isSaving.set(false);
          console.error('Failed to update summary:', error);
        },
      });
  }

  public approve(): void {
    this.isApproving.set(true);

    this.meetingService
      .approvePastMeetingSummary(this.pastMeetingUid, this.summaryUid)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Summary approved successfully',
          });
          this.isApproved.set(true);
          this.wasUpdated.set(true);
          this.isApproving.set(false);
        },
        error: (error: unknown) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to approve summary',
          });
          this.isApproving.set(false);
          console.error('Failed to approve summary:', error);
        },
      });
  }

  public onClose(): void {
    // Return updated content if changes were saved
    if (this.wasUpdated()) {
      this.dialogRef.close({ updated: true, content: this.originalContent(), approved: this.isApproved() });
    } else {
      this.dialogRef.close();
    }
  }
}
