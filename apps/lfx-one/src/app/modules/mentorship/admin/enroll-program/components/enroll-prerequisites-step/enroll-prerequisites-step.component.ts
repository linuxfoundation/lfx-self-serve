// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import {
  createEmptyCustomMentorshipPrerequisite,
  MENTORSHIP_COVER_LETTER_PROMPTS,
  MENTORSHIP_ENROLL_PREREQ_INTRO,
  MENTORSHIP_ENROLL_TERMS_INTRO,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollFieldErrors, MentorshipPrerequisite } from '@lfx-one/shared/interfaces';
import { startWith, switchMap } from 'rxjs';

import { TermsAcknowledgementComponent } from '../../../../components/terms-acknowledgement/terms-acknowledgement.component';
import { EnrollCustomPrerequisiteComponent } from '../enroll-custom-prerequisite/enroll-custom-prerequisite.component';

@Component({
  selector: 'lfx-mentorship-enroll-prerequisites-step',
  imports: [ButtonComponent, InputTextComponent, EnrollCustomPrerequisiteComponent, TermsAcknowledgementComponent],
  templateUrl: './enroll-prerequisites-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollPrerequisitesStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});

  protected readonly prereqIntro = MENTORSHIP_ENROLL_PREREQ_INTRO;
  protected readonly termsIntro = MENTORSHIP_ENROLL_TERMS_INTRO;
  protected readonly coverLetterPrompts = MENTORSHIP_COVER_LETTER_PROMPTS;

  /** Only the coding-challenge prerequisite carries a URL, so one control covers the whole table. */
  protected readonly challengeForm = new FormGroup({
    challengeUrl: new FormControl('', { nonNullable: true }),
  });

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly prerequisites = computed(() => {
    const fromSnapshot = this.formSnapshot()['prerequisites'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as MentorshipPrerequisite[];
    return (this.form().controls['prerequisites']?.value as MentorshipPrerequisite[]) ?? [];
  });

  protected readonly builtInPrerequisites = computed(() => this.prerequisites().filter((item) => !item.custom));
  protected readonly customPrerequisites = computed(() => this.prerequisites().filter((item) => item.custom));
  protected readonly showCustomErrors = computed(() => !!this.errors().prerequisites);
  protected readonly challengePrerequisite = computed(() => this.prerequisites().find((item) => item.challengeUrl !== undefined) ?? null);

  public constructor() {
    toObservable(this.challengePrerequisite)
      .pipe(takeUntilDestroyed())
      .subscribe((item) => {
        const next = item?.challengeUrl ?? '';
        if (this.challengeForm.controls.challengeUrl.value !== next) {
          this.challengeForm.controls.challengeUrl.setValue(next, { emitEvent: false });
        }
      });

    this.challengeForm.controls.challengeUrl.valueChanges.pipe(takeUntilDestroyed()).subscribe((challengeUrl) => {
      const item = this.challengePrerequisite();
      if (item) this.updateChallengeUrl(item.id, challengeUrl);
    });
  }

  protected toggleRequired(id: string): void {
    this.setPrerequisites(this.prerequisites().map((item) => (item.id === id ? { ...item, required: !item.required } : item)));
  }

  protected updateChallengeUrl(id: string, challengeUrl: string): void {
    this.setPrerequisites(this.prerequisites().map((item) => (item.id === id ? { ...item, challengeUrl } : item)));
  }

  protected addCustomPrerequisite(): void {
    this.setPrerequisites([...this.prerequisites(), createEmptyCustomMentorshipPrerequisite()]);
  }

  protected updateCustomPrerequisite(next: MentorshipPrerequisite): void {
    this.setPrerequisites(this.prerequisites().map((item) => (item.id === next.id ? next : item)));
  }

  protected deleteCustomPrerequisite(id: string): void {
    this.setPrerequisites(this.prerequisites().filter((item) => item.id !== id));
  }

  private setPrerequisites(prerequisites: MentorshipPrerequisite[]): void {
    this.form().controls['prerequisites'].setValue(prerequisites);
  }
}
