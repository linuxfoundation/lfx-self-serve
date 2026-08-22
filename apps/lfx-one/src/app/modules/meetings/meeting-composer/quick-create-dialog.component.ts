// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, output, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { DEFAULT_DURATION, MEETING_AGENDA_MAX_LENGTH, MEETING_AGENDA_WARNING_LENGTH, MEETING_TEMPLATES } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { CommitteeMember, MeetingTemplate } from '@lfx-one/shared/interfaces';
import { DialogModule } from 'primeng/dialog';
import { startWith, switchMap } from 'rxjs';

import { MeetingCommitteeManagerComponent } from '../components/meeting-committee-manager/meeting-committee-manager.component';
import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';
import { ComposerDateScheduleComponent } from './sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from './sections/composer-details-access.component';

/**
 * Quick create dialog (LFXV2-3241).
 * @description The condensed create surface: the same form and the same submit path as the drawer, laid
 * out as two columns with no rail and no per-section gating. It composes the drawer's Details & Access
 * and Date & Schedule sections rather than reimplementing their controls, so validators, hint copy and
 * type-driven defaults can't drift between the two surfaces. Platform, features and resources keep
 * their form defaults and are edited later in the drawer.
 */
@Component({
  selector: 'lfx-quick-create-dialog',
  imports: [
    NgClass,
    DialogModule,
    ButtonComponent,
    TextareaComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    MeetingCommitteeManagerComponent,
  ],
  templateUrl: './quick-create-dialog.component.html',
})
export class QuickCreateDialogComponent {
  protected readonly composer = inject(MeetingComposerService);
  protected readonly formService = inject(MeetingComposerFormService);

  /** Submit stays with the host, so both surfaces save through one path. */
  public readonly create = output<void>();

  protected readonly agendaMaxLength = MEETING_AGENDA_MAX_LENGTH;

  /** Meeting type whose template was applied, so the prefill hints only claim what was actually filled. */
  protected readonly prefilledType = signal<MeetingType | null>(null);

  protected readonly agendaLength: Signal<number> = computed(() => {
    this.formService.revision();
    return (this.formService.form().get('description')?.value as string | null)?.length ?? 0;
  });
  protected readonly agendaCounterClass: Signal<string> = computed(() => {
    const length = this.agendaLength();

    if (length >= MEETING_AGENDA_MAX_LENGTH) {
      return 'text-red-600';
    }

    return length >= MEETING_AGENDA_WARNING_LENGTH ? 'text-amber-600' : 'text-gray-500';
  });
  protected readonly canSubmit: Signal<boolean> = computed(() => {
    // FormGroup validity is not reactive; `revision` is what makes this recompute.
    this.formService.revision();
    return this.formService.form().valid;
  });

  public constructor() {
    // The form instance is replaced on every open, and the type can be seeded by the entry point before
    // this dialog mounts, so the current value is replayed rather than waiting for the next change.
    toObservable(this.formService.form)
      .pipe(
        switchMap((form) => {
          const control = form.get('meeting_type');
          return control ? control.valueChanges.pipe(startWith(control.value as MeetingType | null)) : [];
        }),
        takeUntilDestroyed()
      )
      .subscribe((meetingType: MeetingType | null) => this.applyTypeTemplate(meetingType));
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.composer.close();
    }
  }

  protected onCommitteeMembersChange(members: CommitteeMember[]): void {
    this.formService.syncCommitteeMembers(members);
  }

  protected onCreate(): void {
    this.create.emit();
  }

  /**
   * Seeds title, agenda and duration from the meeting type's first template.
   * @description Only untouched fields are written — switching type after typing a title must not discard
   * it — so duration is seeded only while it still holds the form default.
   */
  private applyTypeTemplate(meetingType: MeetingType | null): void {
    const template = meetingType ? this.firstTemplate(meetingType) : null;

    if (!template) {
      this.prefilledType.set(null);
      return;
    }

    const form = this.formService.form();
    const title = form.get('title');
    const description = form.get('description');

    if (!(title?.value as string | null)?.trim()) {
      title?.setValue(template.title);
    }

    if (!(description?.value as string | null)?.trim()) {
      description?.setValue(template.content);
    }

    if (this.formService.effectiveDuration() === DEFAULT_DURATION) {
      this.formService.setDuration(template.estimatedDuration);
    }

    this.prefilledType.set(meetingType);
  }

  private firstTemplate(meetingType: MeetingType): MeetingTemplate | null {
    return MEETING_TEMPLATES.find((group) => group.meetingType === meetingType)?.templates[0] ?? null;
  }
}
