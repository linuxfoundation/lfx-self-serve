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
  MEETING_AGENDA_PROMPT_MAX_LENGTH,
  MEETING_AGENDA_PROMPT_WARNING_LENGTH,
  MEETING_AGENDA_WARNING_LENGTH,
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
import { Popover, PopoverModule } from 'primeng/popover';
import { catchError, EMPTY, finalize, take, tap } from 'rxjs';

import { AgendaTemplateSelectorComponent } from '../../components/agenda-template-selector/agenda-template-selector.component';
import { AddLinkDialogComponent } from '../add-link-dialog/add-link-dialog.component';
import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Agenda & Resources section of the meeting composer (GH-1458).
 * @description Attachments and links are read straight off the form controls rather than mirrored into
 * local signals: the host's `@switch` destroys this component on every section change, so any local
 * copy of the queue would be lost.
 */
@Component({
  selector: 'lfx-composer-agenda-resources',
  imports: [NgClass, PopoverModule, ButtonComponent, FileUploadComponent, TextareaComponent, FileSizePipe, AgendaTemplateSelectorComponent],
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
  /** Hard cap on the AI goal. Enforced as a native `maxlength` attribute on the textarea and again by
   * the server, which truncates an over-budget descriptor rather than dropping it — never as a
   * validator: see the control's declaration in `MeetingComposerFormService` for why a validator on
   * this scratch field would silently block the meeting save. */
  protected readonly promptMaxLength = MEETING_AGENDA_PROMPT_MAX_LENGTH;
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
  // The prompt cap is a native attribute with no validator behind it, so without a counter the field
  // just stops accepting characters with nothing to explain why.
  protected readonly aiPromptLength: Signal<number> = computed(() => {
    this.formService.revision();
    return (this.form().get('aiPrompt')?.value as string | null)?.length ?? 0;
  });
  protected readonly agendaCounterClass: Signal<string> = computed(() =>
    this.counterClass(this.agendaLength(), MEETING_AGENDA_WARNING_LENGTH, MEETING_AGENDA_MAX_LENGTH)
  );
  // Same escalation as the agenda's counter two fields up. Without it the prompt counter reads a flat
  // gray at the exact moment it matters — when the field has saturated and is dropping keystrokes.
  protected readonly aiPromptCounterClass: Signal<string> = computed(() =>
    this.counterClass(this.aiPromptLength(), MEETING_AGENDA_PROMPT_WARNING_LENGTH, MEETING_AGENDA_PROMPT_MAX_LENGTH)
  );
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

  /** Templates are grouped by meeting type, so the popover has nothing to show until one is picked. */
  protected onToggleTemplates(event: MouseEvent, popover: Popover): void {
    if (!this.meetingType()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Pick a meeting type',
        detail: 'Templates are grouped by meeting type — choose one in Details & Access first.',
      });
      return;
    }

    popover.toggle(event);
  }

  /** The prompt is scratch state: it resets whenever the popover closes, however it was closed. */
  protected onAiHelperHide(): void {
    this.showAiHelper.set(false);
    this.form().get('aiPrompt')?.setValue('');
  }

  protected onApplyTemplate(template: MeetingTemplate, popover: Popover): void {
    this.form().get('description')?.setValue(template.content);
    this.applyEstimatedDuration(template.estimatedDuration);
    popover.hide();
  }

  protected onGenerateAgenda(popover: Popover): void {
    const form = this.form();
    const context = (form.get('aiPrompt')?.value as string | null)?.trim() || null;
    const title = (form.get('title')?.value as string | null)?.trim() || null;
    const meetingType = this.meetingType();
    const project = this.projectContextService.activeContext();

    // A title or a goal — whichever the organizer has — is enough. Edit mode drops the rail's
    // section locking entirely, so the organizer can be standing here having just cleared the title;
    // the project also resolves asynchronously and may not be there yet. The backend omits absent
    // descriptors from the prompt and truncates over-budget ones rather than rejecting the request, so
    // this presence-only guard mirrors the server's `!title && !context` contract exactly — nothing
    // that passes here can fail there for length.
    if (!context && !title) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Missing information',
        detail: 'Add a meeting title, or describe what the meeting is for, before generating an agenda.',
      });
      return;
    }

    const request: GenerateAgendaRequest = {
      ...(meetingType ? { meetingType } : {}),
      ...(title ? { title } : {}),
      ...(project ? { projectName: project.name } : {}),
      ...(context ? { context } : {}),
      maxCharacters: MEETING_AGENDA_MAX_LENGTH,
    };

    this.isGeneratingAgenda.set(true);
    this.meetingService
      .generateAgenda(request)
      .pipe(
        take(1),
        tap({
          next: (response) => {
            this.form().get('description')?.setValue(response.agenda);
            this.applyEstimatedDuration(response.estimatedDuration);
            popover.hide();
            this.messageService.add({ severity: 'success', summary: 'Agenda generated', detail: 'Review the draft and edit it as needed.' });
          },
          // `MeetingService.generateAgenda` already logs the failure before re-throwing.
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
   * @description The estimate is rounded first, since the AI path can return a fractional minute count
   * and the duration controls only accept whole minutes. Three outcomes then follow: an estimate outside
   * the allowed range is dropped with a warning (writing it would trip the form service's min/max
   * validators and deaden submit from a section the organizer can't see); an estimate that already
   * matches the current duration is a silent no-op; any other estimate is written and announced, since
   * the duration they picked has just been overwritten.
   */
  private applyEstimatedDuration(estimate: number): void {
    const estimatedDuration = Math.round(estimate);

    if (!Number.isFinite(estimatedDuration) || estimatedDuration < MIN_CUSTOM_DURATION || estimatedDuration > MAX_CUSTOM_DURATION) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Duration left unchanged',
        detail: `The suggested duration is outside the allowed ${MIN_CUSTOM_DURATION}–${MAX_CUSTOM_DURATION} minute range. Set it yourself in Date & Schedule.`,
      });
      return;
    }

    if (this.formService.effectiveDuration() === estimatedDuration) {
      return;
    }

    this.formService.setDuration(estimatedDuration);

    this.messageService.add({
      severity: 'info',
      summary: 'Duration updated',
      detail: `Meeting duration set to ${estimatedDuration} minutes. Change it in Date & Schedule if that's not right.`,
    });
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

  /** Shared escalation for both character counters in this section: gray, amber near the cap, red at it. */
  private counterClass(length: number, warnAt: number, max: number): string {
    if (length >= max) {
      return 'text-red-600';
    }

    return length >= warnAt ? 'text-amber-600' : 'text-gray-500';
  }
}
