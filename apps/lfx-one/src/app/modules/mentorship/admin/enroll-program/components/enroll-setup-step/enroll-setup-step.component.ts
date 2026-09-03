// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  MENTORSHIP_ENROLL_SETUP_INTRO,
  MENTORSHIP_ENROLL_SETUP_MENTOR_INFO,
  MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER,
  MENTORSHIP_ENROLL_SETUP_TERMS_HELPER,
  MENTORSHIP_SKILL_OPTIONS,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollFieldErrors, MentorshipProgramTerm, MentorshipTermFormDialogData } from '@lfx-one/shared/interfaces';
import { formatMentorshipMonthYear } from '@lfx-one/shared/utils';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, switchMap, take } from 'rxjs';

import { EnrollTermDialogComponent } from '../enroll-term-dialog/enroll-term-dialog.component';

@Component({
  selector: 'lfx-mentorship-enroll-setup-step',
  imports: [ReactiveFormsModule, SelectComponent, ButtonComponent],
  templateUrl: './enroll-setup-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollSetupStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});

  private readonly dialogService = inject(DialogService);

  protected readonly draftSkillForm = new FormGroup({
    skill: new FormControl('', { nonNullable: true }),
  });

  protected readonly intro = MENTORSHIP_ENROLL_SETUP_INTRO;
  protected readonly skillsHelper = MENTORSHIP_ENROLL_SETUP_SKILLS_HELPER;
  protected readonly mentorInfo = MENTORSHIP_ENROLL_SETUP_MENTOR_INFO;
  protected readonly termsHelper = MENTORSHIP_ENROLL_SETUP_TERMS_HELPER;

  protected readonly draftSkillValue = toSignal(this.draftSkillForm.controls.skill.valueChanges, { initialValue: '' });

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly skills = computed(() => {
    const fromSnapshot = this.formSnapshot()['skills'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as string[];
    return (this.form().controls['skills']?.value as string[]) ?? [];
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

  protected readonly availableSkills = computed(() => {
    const selected = new Set(this.skills().map((item) => item.toLowerCase()));
    return MENTORSHIP_SKILL_OPTIONS.filter((skill) => !selected.has(skill.toLowerCase())).map((skill) => ({ label: skill, value: skill }));
  });

  protected addSkill(): void {
    const value = this.draftSkillForm.controls.skill.value.trim();
    if (!value) return;
    const current = this.skills();
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    this.form().controls['skills'].setValue([...current, value]);
    this.draftSkillForm.controls.skill.setValue('');
  }

  protected removeSkill(skill: string): void {
    this.form().controls['skills'].setValue(this.skills().filter((item) => item !== skill));
  }

  protected addTerm(): void {
    this.openTermDialog({ mode: 'add' });
  }

  protected editTerm(id: string): void {
    const term = this.terms().find((item) => item.id === id);
    if (!term) return;
    this.openTermDialog({ mode: 'edit', term });
  }

  protected deleteTerm(id: string): void {
    this.form().controls['terms'].setValue(this.terms().filter((term) => term.id !== id));
  }

  private openTermDialog(data: MentorshipTermFormDialogData): void {
    const dialogRef = this.dialogService.open(EnrollTermDialogComponent, {
      header: data.mode === 'edit' ? 'Edit Term' : '',
      width: '36rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: MentorshipProgramTerm | undefined) => {
      if (!result) return;
      if (data.mode === 'edit') {
        this.form().controls['terms'].setValue(this.terms().map((term) => (term.id === result.id ? result : term)));
        return;
      }
      this.form().controls['terms'].setValue([...this.terms(), result]);
    });
  }
}
