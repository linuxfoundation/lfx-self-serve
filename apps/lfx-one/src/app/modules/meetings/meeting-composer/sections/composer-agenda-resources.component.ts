// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  ALLOWED_FILE_TYPES,
  MAX_CUSTOM_DURATION,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_AGENDA_WARNING_LENGTH,
  MEETING_DURATION_CHIP_OPTIONS,
  MIN_CUSTOM_DURATION,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { GenerateAgendaRequest, MeetingAttachment, MeetingLinkDialogResult, MeetingTemplate, PendingAttachment } from '@lfx-one/shared/interfaces';
import { generateAcceptString, getAcceptedFileTypesDisplay, getMimeTypeDisplayName, isFileTypeAllowed } from '@lfx-one/shared/utils';
import { FileSizePipe } from '@pipes/file-size.pipe';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, EMPTY, finalize, take, tap } from 'rxjs';

import { AgendaTemplateSelectorComponent } from '../../components/agenda-template-selector/agenda-template-selector.component';
import { AddLinkDialogComponent } from '../add-link-dialog/add-link-dialog.component';
import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Agenda & Resources section of the meeting composer (LFXV2-3239).
 * @description Attachments and links are read straight off the form controls rather than mirrored into
 * local signals: the host's `@switch` destroys this component on every section change, so any local
 * copy of the queue would be lost.
 */
@Component({
  selector: 'lfx-composer-agenda-resources',
  imports: [NgClass, ButtonComponent, FileUploadComponent, TextareaComponent, FileSizePipe, AgendaTemplateSelectorComponent],
  templateUrl: './composer-agenda-resources.component.html',
})
export class ComposerAgendaResourcesComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();

  protected readonly agendaMaxLength = MEETING_AGENDA_MAX_LENGTH;
  protected readonly maxFileSizeBytes = MAX_FILE_SIZE_BYTES;
  protected readonly acceptString = generateAcceptString();
  protected readonly acceptedTypesDisplay = getAcceptedFileTypesDisplay();

  protected readonly showTemplates = signal(false);
  protected readonly showAiHelper = signal(false);
  protected readonly isGeneratingAgenda = signal(false);

  protected readonly meetingType: Signal<MeetingType | null> = computed(() => {
    this.formService.revision();
    return (this.form().get('meeting_type')?.value as MeetingType | null) || null;
  });
  protected readonly agendaLength: Signal<number> = computed(() => {
    this.formService.revision();
    return (this.form().get('description')?.value as string | null)?.length ?? 0;
  });
  protected readonly agendaCounterClass: Signal<string> = computed(() => {
    const length = this.agendaLength();

    if (length >= MEETING_AGENDA_MAX_LENGTH) {
      return 'text-red-600';
    }

    return length >= MEETING_AGENDA_WARNING_LENGTH ? 'text-amber-600' : 'text-gray-500';
  });
  protected readonly pendingAttachments: Signal<PendingAttachment[]> = computed(() => {
    this.formService.revision();
    return (this.form().get('attachments')?.value as PendingAttachment[] | null) ?? [];
  });
  protected readonly savedFileAttachments: Signal<MeetingAttachment[]> = computed(() =>
    this.formService.attachments().filter((attachment) => attachment.type === 'file')
  );
  protected readonly pendingDeletionSet: Signal<Set<string>> = computed(() => new Set(this.formService.pendingAttachmentDeletions()));
  // FormArray mutates `controls` in place, so a copy is what makes the recompute a real signal change.
  protected readonly linkControls: Signal<FormGroup[]> = computed(() => {
    this.formService.revision();
    return [...this.linksArray().controls] as FormGroup[];
  });

  protected onToggleTemplates(): void {
    if (!this.meetingType()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Pick a meeting type',
        detail: 'Templates are grouped by meeting type — choose one in Details & Access first.',
      });
      return;
    }

    this.showAiHelper.set(false);
    this.showTemplates.update((visible) => !visible);
  }

  protected onToggleAiHelper(): void {
    this.showTemplates.set(false);
    this.showAiHelper.update((visible) => !visible);
  }

  protected onCloseTemplates(): void {
    this.showTemplates.set(false);
  }

  protected onCancelAiHelper(): void {
    this.showAiHelper.set(false);
    this.form().get('aiPrompt')?.setValue('');
  }

  protected onApplyTemplate(template: MeetingTemplate): void {
    this.form().get('description')?.setValue(template.content);
    this.applyEstimatedDuration(template.estimatedDuration);
    this.showTemplates.set(false);
  }

  protected onGenerateAgenda(): void {
    const form = this.form();
    const context = form.get('aiPrompt')?.value as string | null;
    const title = form.get('title')?.value as string | null;
    const meetingType = this.meetingType();
    const project = this.projectContextService.activeContext();

    if (!project || !title || !meetingType || !context) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing information',
        detail: 'Add the meeting title and type, and describe the goal, before generating an agenda.',
      });
      return;
    }

    const request: GenerateAgendaRequest = { meetingType, title, projectName: project.name, context, maxCharacters: MEETING_AGENDA_MAX_LENGTH };

    this.isGeneratingAgenda.set(true);
    this.meetingService
      .generateAgenda(request)
      .pipe(
        take(1),
        tap({
          next: (response) => {
            this.form().get('description')?.setValue(response.agenda);
            this.applyEstimatedDuration(response.estimatedDuration);
            this.onCancelAiHelper();
            this.messageService.add({ severity: 'success', summary: 'Agenda generated', detail: 'Review the draft and edit it as needed.' });
          },
          error: () => {
            this.messageService.add({ severity: 'error', summary: 'Generation failed', detail: 'Could not generate an agenda. Please try again.' });
          },
        }),
        catchError(() => EMPTY),
        finalize(() => this.isGeneratingAgenda.set(false))
      )
      .subscribe();
  }

  protected onFileSelect(event: { files?: File[]; currentFiles?: File[] }): void {
    const files = event.files ?? event.currentFiles ?? [];
    if (files.length === 0) {
      return;
    }

    const accepted = files.reduce<PendingAttachment[]>((kept, file) => {
      const error = this.validateFile(file, [...this.pendingAttachments(), ...kept]);

      if (error) {
        this.messageService.add({ severity: 'error', summary: 'File not added', detail: error, life: 5000 });
        return kept;
      }

      kept.push({
        id: crypto.randomUUID(),
        fileName: file.name,
        file,
        fileSize: file.size,
        mimeType: file.type,
        uploading: false,
        uploaded: false,
      });

      return kept;
    }, []);

    if (accepted.length > 0) {
      this.form()
        .get('attachments')
        ?.setValue([...this.pendingAttachments(), ...accepted]);
    }
  }

  protected onRemoveAttachment(id: string): void {
    this.form()
      .get('attachments')
      ?.setValue(this.pendingAttachments().filter((attachment) => attachment.id !== id));
  }

  protected onAddLink(): void {
    const dialogRef = this.dialogService.open(AddLinkDialogComponent, {
      header: 'Add link',
      width: 'min(520px, 94vw)',
      modal: true,
      closable: true,
      dismissableMask: true,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MeetingLinkDialogResult | undefined) => {
      if (result) {
        this.appendLink(result);
      }
    });
  }

  protected onRemoveLink(index: number): void {
    const uid = this.linksArray().at(index)?.get('uid')?.value as string | null;

    // The link already exists upstream, so removing the row has to be reported as a deletion on save.
    if (uid) {
      this.formService.deleteLinkAttachment(uid);
    }

    this.linksArray().removeAt(index);
  }

  private appendLink(link: MeetingLinkDialogResult): void {
    this.linksArray().push(
      new FormGroup({
        id: new FormControl(crypto.randomUUID()),
        title: new FormControl(link.title),
        url: new FormControl(link.url),
        uid: new FormControl<string | null>(null),
      })
    );
  }

  private linksArray(): FormArray {
    return this.form().get('important_links') as FormArray;
  }

  /**
   * Applies a template's or AI draft's estimated duration to the schedule controls.
   * @description Estimates outside the chip values go to `customDuration` rather than being clamped.
   * An estimate outside the allowed range is dropped rather than written: the form service's min/max
   * validators would block submit from a section the organizer can't see. The toast fires either way
   * because the duration they picked has just been overwritten — or deliberately left alone.
   */
  private applyEstimatedDuration(estimatedDuration: number): void {
    if (!Number.isFinite(estimatedDuration) || estimatedDuration < MIN_CUSTOM_DURATION || estimatedDuration > MAX_CUSTOM_DURATION) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Duration left unchanged',
        detail: `The suggested duration is outside the allowed ${MIN_CUSTOM_DURATION}–${MAX_CUSTOM_DURATION} minute range. Set it yourself in Date & Schedule.`,
      });
      return;
    }

    const isChipValue = MEETING_DURATION_CHIP_OPTIONS.some((option) => option.value === estimatedDuration);
    const customDuration = this.form().get('customDuration');
    const durationControl = this.form().get('duration');

    if (this.effectiveDuration() === estimatedDuration) {
      return;
    }

    durationControl?.setValue(isChipValue ? estimatedDuration : 'custom');
    customDuration?.setValue(isChipValue ? null : estimatedDuration);

    if (!isChipValue) {
      customDuration?.markAsTouched();
    }

    this.messageService.add({
      severity: 'info',
      summary: 'Duration updated',
      detail: `Meeting duration set to ${estimatedDuration} minutes. Change it in Date & Schedule if that's not right.`,
    });
  }

  /** Minutes the form currently resolves to, whichever of the two duration controls holds it. */
  private effectiveDuration(): number | null {
    const duration = this.form().get('duration')?.value as number | 'custom' | null;

    if (duration === 'custom') {
      return (this.form().get('customDuration')?.value as number | null) ?? null;
    }

    return duration ?? null;
  }

  private validateFile(file: File, queued: PendingAttachment[]): string | null {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `"${file.name}" is larger than ${MAX_FILE_SIZE_MB}MB.`;
    }

    if (!isFileTypeAllowed(file.type, file.name, ALLOWED_FILE_TYPES)) {
      return `"${getMimeTypeDisplayName(file.type, file.name)}" files aren't supported. Allowed: ${this.acceptedTypesDisplay}.`;
    }

    if (queued.some((attachment) => attachment.fileName === file.name && !attachment.uploadError)) {
      return `"${file.name}" has already been added.`;
    }

    if (file.name.includes('..') || file.name.startsWith('.')) {
      return `"${file.name}" is not a valid filename.`;
    }

    return null;
  }
}
