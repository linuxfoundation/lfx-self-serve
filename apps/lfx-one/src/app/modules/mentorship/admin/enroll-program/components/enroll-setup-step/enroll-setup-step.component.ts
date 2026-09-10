// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM,
  MENTORSHIP_ENROLL_SETUP_INTRO,
  MENTORSHIP_ENROLL_SETUP_MENTOR_INFO,
  MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER,
  MENTORSHIP_ENROLL_SETUP_TERMS_HELPER,
  MENTORSHIP_MAX_OPEN_TERMS,
  MENTORSHIP_MAX_OPEN_TERMS_MESSAGE,
  MENTORSHIP_MENTOR_DOCS_URL,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollFieldErrors, MentorshipProgramTerm, MentorshipTermFormDialogData } from '@lfx-one/shared/interfaces';
import { formatMentorshipMonthYear } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, switchMap, take } from 'rxjs';

import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { EnrollTermDialogComponent } from '../enroll-term-dialog/enroll-term-dialog.component';

@Component({
  selector: 'lfx-mentorship-enroll-setup-step',
  imports: [ButtonComponent, SkillsPickerComponent],
  templateUrl: './enroll-setup-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollSetupStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});

  private readonly dialogService = inject(DialogService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly intro = MENTORSHIP_ENROLL_SETUP_INTRO;
  protected readonly skillsHelper = MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER;
  protected readonly mentorInfo = MENTORSHIP_ENROLL_SETUP_MENTOR_INFO;
  protected readonly termsHelper = MENTORSHIP_ENROLL_SETUP_TERMS_HELPER;
  protected readonly mentorDocsUrl = MENTORSHIP_MENTOR_DOCS_URL;
  protected readonly maxTerms = MENTORSHIP_MAX_OPEN_TERMS;
  protected readonly maxTermsMessage = MENTORSHIP_MAX_OPEN_TERMS_MESSAGE;

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly terms = computed(() => {
    const fromSnapshot = this.formSnapshot()['terms'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as MentorshipProgramTerm[];
    return (this.form().controls['terms']?.value as MentorshipProgramTerm[]) ?? [];
  });

  protected readonly termRows = computed(() =>
    this.terms().map((term) => ({
      ...term,
      startsLabel: formatMentorshipMonthYear(term.startDate),
      endsLabel: formatMentorshipMonthYear(term.endDate),
    }))
  );

  protected readonly canAddTerm = computed(() => this.terms().length < this.maxTerms);

  protected addTerm(): void {
    if (!this.canAddTerm()) return;
    this.openTermDialog({ mode: 'add' });
  }

  protected editTerm(id: string): void {
    const term = this.terms().find((item) => item.id === id);
    if (!term) return;
    this.openTermDialog({ mode: 'edit', term });
  }

  protected deleteTerm(id: string): void {
    this.confirmationService.confirm({
      header: 'Delete Term',
      message: MENTORSHIP_ENROLL_DELETE_TERM_CONFIRM,
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Delete Term',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm p-button-outlined',
      accept: () => {
        this.form().controls['terms'].setValue(this.terms().filter((term) => term.id !== id));
      },
    });
  }

  private openTermDialog(data: MentorshipTermFormDialogData): void {
    const dialogRef = this.dialogService.open(EnrollTermDialogComponent, {
      header: data.mode === 'edit' ? 'Edit Term' : 'Add Term',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result: MentorshipProgramTerm | undefined) => {
      if (!result) return;
      if (data.mode === 'edit') {
        this.form().controls['terms'].setValue(this.terms().map((term) => (term.id === result.id ? result : term)));
        return;
      }
      this.form().controls['terms'].setValue([...this.terms(), result]);
    });
  }
}
