// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_INTRO,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS,
  MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL,
  MENTORSHIP_MENTEE_RESUME_INTRO,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { capCodePointEdit, codePointLength, htmlClipboardToText, normalizeToUrl } from '@lfx-one/shared/utils';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { DrawerModule } from 'primeng/drawer';
import { filter, startWith } from 'rxjs';

import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

/** Angular `minLength` skips empty values, so `[]` would otherwise pass as valid. */
function requiredStringList(): ValidatorFn {
  return (control) => (Array.isArray(control.value) && control.value.length > 0 ? null : { required: true });
}

/**
 * Right-side mentee profile edit drawer, opened from the "Edit Mentee Profile" button
 * on the standalone mentee profile page. Fields map to `user_profiles`: About Me ←
 * `introduction`, skills ← `skill_set.skills` / `improvementSkills`, additional notes
 * ← `skill_set.comments`, resume filename as display-only from `profile_links.resumeLink`.
 *
 * Save fires the coming-soon toast until the update endpoint is wired; the drawer does
 * not persist anything.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile-edit-drawer',
  imports: [DrawerModule, ButtonComponent, TextareaComponent, SkillsPickerComponent, ResumeSectionComponent],
  templateUrl: './mentee-profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileEditDrawerComponent {
  private readonly comingSoon = inject(MentorshipComingSoonService);
  private readonly drawer = inject(MenteeProfileEditDrawerService);
  protected readonly isOpen = this.drawer.isOpen;

  protected readonly title = MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL;
  protected readonly subtitle = MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE;
  protected readonly saveLabel = MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL;
  protected readonly cancelLabel = MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL;
  protected readonly aboutIntro = MENTORSHIP_MENTEE_PROFILE_ABOUT_INTRO;
  protected readonly aboutPrompts = MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS;
  protected readonly aboutMeMax = MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX;
  protected readonly skillsIntro = MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO;
  protected readonly skillsHaveLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL;
  protected readonly skillsWantLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL;
  protected readonly additionalNotesLabel = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL;
  protected readonly additionalNotesMax = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX;
  protected readonly resumeIntro = MENTORSHIP_MENTEE_RESUME_INTRO;

  // Code-point cap (not Validators.maxLength, which counts UTF-16 units). Native maxlength
  // is omitted on the About Me textarea for the same reason.
  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true, validators: [maxCodePointsValidator(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX)] }),
    skillsHave: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList()] }),
    skillsWant: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList()] }),
    additionalNotes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX)] }),
    resumeFileName: new FormControl('', { nonNullable: true }),
  });

  protected readonly aboutMeLength = signal(0);
  private lastValidIntroduction = '';
  private seededIntroduction = '';
  private readonly saveAttempted = signal(false);
  private readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });

  protected readonly skillsHaveError = computed(() => this.skillPickerError('skillsHave', 'Add at least one skill you currently have.'));
  protected readonly skillsWantError = computed(() => this.skillPickerError('skillsWant', 'Add at least one skill you would like to improve.'));

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => this.seedForm(profile));

    this.form.controls.introduction.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      const next = value ?? '';
      if (codePointLength(next) > MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX) {
        const capped = capCodePointEdit(this.lastValidIntroduction, next, MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
        this.form.controls.introduction.setValue(capped, { emitEvent: false });
        this.lastValidIntroduction = capped;
        this.aboutMeLength.set(codePointLength(capped));
        if (capped === this.seededIntroduction) {
          this.form.controls.introduction.markAsPristine();
        }
        return;
      }
      this.lastValidIntroduction = next;
      this.aboutMeLength.set(codePointLength(next));
    });
  }

  protected onSave(): void {
    this.form.markAllAsTouched();
    this.saveAttempted.set(true);
    if (this.form.invalid) {
      return;
    }
    // TODO: persist the mentee profile (introduction, skills, notes, resume) when the
    // update endpoint is wired. Until then Save stays a coming-soon stub, same as withdraw.
    this.comingSoon.notify(MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL);
    this.drawer.close();
  }

  protected onCancel(): void {
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.drawer.close();
    }
  }

  private seedForm(profile: MentorshipMenteeProfileDetails): void {
    // Register and the drawer share the 3000 code-point cap. Convert block boundaries
    // to newlines, then cap, *before* patching so the control, counter, and baselines
    // share one value. patchValue must emit so skills pickers and the resume section
    // (which snapshot `valueChanges`) pick up the seeded skills and filename.
    const introduction = capCodePointEdit('', htmlClipboardToText(profile.aboutMe ?? ''), MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
    this.lastValidIntroduction = introduction;
    this.seededIntroduction = introduction;
    this.saveAttempted.set(false);
    this.form.patchValue({
      introduction,
      skillsHave: profile.skillsHave ?? [],
      skillsWant: profile.skillsWant ?? [],
      additionalNotes: profile.additionalNotes ?? '',
      resumeFileName: this.resumeFileNameFromProfile(profile),
    });
    this.aboutMeLength.set(codePointLength(introduction));
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }

  private skillPickerError(control: 'skillsHave' | 'skillsWant', message: string): string | undefined {
    this.formStatus();
    this.saveAttempted();
    const field = this.form.controls[control];
    if (!field.touched || field.valid) return undefined;
    return message;
  }

  /**
   * `resumeFileName` is display-only and independently optional from `resumeUrl`.
   * When the BFF only has the URL, derive the last path segment so the resume
   * section is not seeded empty.
   */
  private resumeFileNameFromProfile(profile: MentorshipMenteeProfileDetails): string {
    const named = profile.resumeFileName?.trim();
    if (named) return named;
    const normalized = normalizeToUrl(profile.resumeUrl?.trim() ?? '');
    if (!normalized) return '';
    try {
      const last = new URL(normalized).pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : '';
    } catch {
      return '';
    }
  }
}
