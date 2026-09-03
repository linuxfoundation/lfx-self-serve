// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import {
  createEmptyCustomMentorshipPrerequisite,
  MENTORSHIP_ENROLL_PREREQ_INTRO,
  MENTORSHIP_ENROLL_TERMS_INTRO,
  mentorshipPolicyHref,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollFieldErrors, MentorshipPrerequisite } from '@lfx-one/shared/interfaces';
import { startWith, switchMap } from 'rxjs';

import { EnrollCustomPrerequisiteComponent } from '../enroll-custom-prerequisite/enroll-custom-prerequisite.component';

@Component({
  selector: 'lfx-mentorship-enroll-prerequisites-step',
  imports: [ReactiveFormsModule, ButtonComponent, CheckboxComponent, EnrollCustomPrerequisiteComponent],
  templateUrl: './enroll-prerequisites-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollPrerequisitesStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});

  protected readonly prereqIntro = MENTORSHIP_ENROLL_PREREQ_INTRO;
  protected readonly termsIntro = MENTORSHIP_ENROLL_TERMS_INTRO;
  protected readonly platformUseHref = mentorshipPolicyHref('LFX Platform Use Agreement');
  protected readonly serviceTermsHref = mentorshipPolicyHref('Service-Specific Use Terms');
  protected readonly acceptableUseHref = mentorshipPolicyHref('Acceptable Use Policy');
  protected readonly privacyHref = mentorshipPolicyHref('Privacy Policy');

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

  protected toggleRequired(id: string): void {
    this.setPrerequisites(this.prerequisites().map((item) => (item.id === id ? { ...item, required: !item.required } : item)));
  }

  protected updateChallengeUrl(id: string, challengeUrl: string): void {
    this.setPrerequisites(this.prerequisites().map((item) => (item.id === id ? { ...item, challengeUrl } : item)));
  }

  protected onChallengeUrlInput(id: string, event: Event): void {
    this.updateChallengeUrl(id, (event.target as HTMLInputElement).value);
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
