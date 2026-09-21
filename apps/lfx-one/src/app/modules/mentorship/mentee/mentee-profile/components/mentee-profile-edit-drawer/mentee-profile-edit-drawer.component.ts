// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, Validators } from '@angular/forms';
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
import { codePointLength, stripHtml } from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';
import { filter, map, startWith } from 'rxjs';

import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MentorshipComingSoonService } from '../../../../services/mentorship-coming-soon.service';
import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

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
  protected readonly drawer = inject(MenteeProfileEditDrawerService);

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

  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX)] }),
    skillsHave: new FormControl<string[]>([], { nonNullable: true }),
    skillsWant: new FormControl<string[]>([], { nonNullable: true }),
    additionalNotes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX)] }),
    resumeFileName: new FormControl('', { nonNullable: true }),
  });

  protected readonly aboutMeLength: Signal<number> = this.initAboutMeLength();

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => this.seedForm(profile));
  }

  protected onSave(): void {
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

  private initAboutMeLength(): Signal<number> {
    return toSignal(
      this.form.controls.introduction.valueChanges.pipe(
        startWith(this.form.controls.introduction.value),
        map((value) => codePointLength(value ?? ''))
      ),
      { initialValue: 0 }
    );
  }

  private seedForm(profile: MentorshipMenteeProfileDetails): void {
    this.form.patchValue({
      introduction: stripHtml(profile.aboutMe ?? ''),
      skillsHave: profile.skillsHave ?? [],
      skillsWant: profile.skillsWant ?? [],
      additionalNotes: profile.additionalNotes ?? '',
      resumeFileName: profile.resumeFileName ?? '',
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
  }
}
