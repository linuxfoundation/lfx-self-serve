// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MAX_CUSTOM_DURATION,
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_AGENDA_PROMPT_MAX_LENGTH,
  MEETING_AGENDA_WARNING_LENGTH,
  MIN_CUSTOM_DURATION,
} from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { GenerateAgendaRequest, MeetingTemplate } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { controlErrorSignal } from '@shared/utils/form-control-signals.util';
import { MessageService } from 'primeng/api';
import { Popover, PopoverModule } from 'primeng/popover';
import { catchError, EMPTY, finalize, take, tap } from 'rxjs';

import { AgendaTemplateSelectorComponent } from '../components/agenda-template-selector/agenda-template-selector.component';
import { MeetingComposerFormService } from './meeting-composer-form.service';

/**
 * The agenda field with its two authoring aids — Templates and Help me write (GH-1458).
 * @description Shared by the drawer's Agenda & resources section and the quick create dialog: both are
 * bound to the same `MeetingComposerFormService` form, so the whole feature travels with the `description`
 * and `aiPrompt` controls and needs nothing from its host beyond the ids that keep each surface's
 * `data-testid`s and label associations stable.
 */
@Component({
  selector: 'lfx-composer-agenda-field',
  imports: [NgClass, PopoverModule, ButtonComponent, TextareaComponent, AgendaTemplateSelectorComponent],
  templateUrl: './composer-agenda-field.component.html',
  styleUrl: './composer-agenda-field.component.scss',
})
export class ComposerAgendaFieldComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);
  protected readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();
  /** Also the prefix for every `data-testid` in here, so each surface keeps the ids it already had. */
  public readonly inputId = input<string>('composer-agenda');
  public readonly rows = input<number>(8);
  public readonly textareaClass = input<string>('w-full min-h-48');
  /** Rendered below the textarea and wired to it through `aria-describedby` when present. */
  public readonly hint = input<string | null>(null);

  protected readonly agendaMaxLength = MEETING_AGENDA_MAX_LENGTH;
  /** Hard cap on the AI goal. Enforced as a native `maxlength` attribute on the textarea and again by
   * the server, which truncates an over-budget descriptor rather than dropping it — never as a
   * validator: see the control's declaration in `MeetingComposerFormService` for why a validator on
   * this scratch field would silently block the meeting save. */
  protected readonly promptMaxLength = MEETING_AGENDA_PROMPT_MAX_LENGTH;

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
  /**
   * Whether the agenda is over the cap — ungated by `touched` on purpose.
   * @description The textarea carries a native `maxlength`, so nobody can type past the cap: an
   * over-length agenda can only arrive from edit-mode hydration of an older meeting or from an AI
   * generation, and in both cases the control is never touched. Gating this on a blur the organizer
   * has no reason to perform would leave the save silently blocked with a red counter and no reason.
   */
  protected readonly agendaTooLong: Signal<boolean> = controlErrorSignal(this.form, 'description', 'maxlength');
  protected readonly agendaDescribedBy: Signal<string | undefined> = this.initAgendaDescribedBy();

  protected readonly agendaCounterClass: Signal<string> = computed(() => {
    const length = this.agendaLength();

    if (length >= MEETING_AGENDA_MAX_LENGTH) {
      return 'text-red-600';
    }

    return length >= MEETING_AGENDA_WARNING_LENGTH ? 'text-amber-600' : 'text-gray-500';
  });

  /** Templates are grouped by meeting type, so the popover has nothing to show until one is picked. */
  protected onToggleTemplates(event: MouseEvent, popover: Popover): void {
    if (!this.meetingType()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Pick a meeting type',
        detail: 'Templates are grouped by meeting type — choose one first.',
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
    this.writeAgenda(template.content);
    this.applyEstimatedDuration(template.estimatedDuration);
    popover.hide();
  }

  protected onGenerateAgenda(popover: Popover): void {
    const form = this.form();
    const context = (form.get('aiPrompt')?.value as string | null)?.trim() || null;
    const title = (form.get('title')?.value as string | null)?.trim() || null;
    const meetingType = this.meetingType();
    // The saved meeting's own project name first: in edit mode the composer is frequently open over a
    // different context (the Me lens, another project), and `project_name` is a required field on the
    // meeting the form already holds — so this is the authoritative name, not a fallback.
    // Otherwise, only name the ambient project when it is the same one the save will write to.
    // `prepareMeetingData()` prefers the captured open-context uid over the ambient one, so a composer
    // opened from a group/deep link while the sidebar still points elsewhere would otherwise ask the
    // model for an agenda about the wrong project. The server omits an absent descriptor, so dropping
    // it is strictly better than sending a mismatched one.
    const project = this.projectContextService.activeContext();
    const ambientProjectName = project && project.uid === this.formService.effectiveProjectUid() ? project.name : null;
    const projectName = this.formService.meeting()?.project_name || ambientProjectName;

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
      ...(projectName ? { projectName } : {}),
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
            this.writeAgenda(response.agenda);
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
        finalize(() => this.isGeneratingAgenda.set(false)),
        // The section is destroyed on every rail change and the whole host on every successful save,
        // so an in-flight generation regularly outlives the component that asked for it. Without this
        // the late response would write an agenda into a form the organizer has already moved on from
        // — or, after a save, into the next meeting's blank one.
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /** Names only the paragraphs the template is currently rendering, so no id ever dangles. */
  private initAgendaDescribedBy(): Signal<string | undefined> {
    return computed(() => {
      const ids = [this.hint() ? `${this.inputId()}-hint` : null, this.agendaTooLong() ? `${this.inputId()}-maxlength-error` : null].filter(
        (id): id is string => id !== null
      );

      return ids.length ? ids.join(' ') : undefined;
    });
  }

  /**
   * Writes an agenda the organizer asked for, and marks it as theirs.
   * @description `setValue` alone leaves the control pristine, which two other surfaces read as "still
   * an untouched default": the quick dialog's type-change prefill would overwrite a template the
   * organizer deliberately picked, and edit mode's dirty-gated Save would stay disabled over a
   * generated agenda with nothing saying why. Asking for this content is a deliberate edit, so it is
   * marked like one.
   */
  private writeAgenda(agenda: string): void {
    const description = this.form().get('description');

    description?.setValue(agenda);
    description?.markAsDirty();
  }

  /**
   * Applies a template's or AI draft's estimated duration to the schedule controls.
   * @description The estimate is rounded first, since the AI path can return a fractional minute count
   * and the duration controls only accept whole minutes. Three outcomes then follow: an estimate outside
   * the allowed range is dropped with a warning (writing it would trip the form service's min/max
   * validators and deaden submit from a field the organizer can't see); an estimate that already
   * matches the current duration is a silent no-op; any other estimate is written and announced, since
   * the duration they picked has just been overwritten.
   */
  private applyEstimatedDuration(estimate: number): void {
    const estimatedDuration = Math.round(estimate);

    if (!Number.isFinite(estimatedDuration) || estimatedDuration < MIN_CUSTOM_DURATION || estimatedDuration > MAX_CUSTOM_DURATION) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Duration left unchanged',
        detail: `The suggested duration is outside the allowed ${MIN_CUSTOM_DURATION}–${MAX_CUSTOM_DURATION} minute range. Set it yourself alongside the date.`,
      });
      return;
    }

    if (this.formService.effectiveDuration() === estimatedDuration) {
      return;
    }

    // Dirty for the same reason the agenda is: `setDuration` writes through `setValue`, and the quick
    // dialog's prefill only skips controls it can see the organizer has moved.
    this.form().get('duration')?.markAsDirty();
    this.form().get('customDuration')?.markAsDirty();

    this.formService.setDuration(estimatedDuration);

    this.messageService.add({
      severity: 'info',
      summary: 'Duration updated',
      detail: `Meeting duration set to ${estimatedDuration} minutes. Change it alongside the date if that's not right.`,
    });
  }
}
