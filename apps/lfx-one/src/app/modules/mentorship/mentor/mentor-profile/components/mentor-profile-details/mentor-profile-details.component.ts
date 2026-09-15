// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY,
  MENTORSHIP_MENTOR_PROFILE_ABOUT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_DETAILS_TITLE,
  MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_RESUME_EMPTY,
  MENTORSHIP_MENTOR_PROFILE_RESUME_LABEL,
  MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY,
  MENTORSHIP_MENTOR_PROFILE_SKILLS_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';

/**
 * Read-only display of the mentor's own profile fields — About Me, Skills, Resume —
 * as they appear on the dedicated `/mentorship/mentor/profile` page. The parent owns
 * the load / error state and passes a resolved `profile` in; this card just renders
 * it. `editClick` is emitted rather than routed so the parent decides whether the
 * Edit action opens a drawer, navigates, or (for now) fires the coming-soon toast.
 */
@Component({
  selector: 'lfx-mentorship-mentor-profile-details',
  imports: [ButtonComponent],
  templateUrl: './mentor-profile-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentorProfileDetailsComponent {
  public readonly profile = input.required<MentorshipMentorProfileDetails>();
  public readonly editClick = output<void>();

  protected readonly title = MENTORSHIP_MENTOR_PROFILE_DETAILS_TITLE;
  protected readonly editLabel = MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL;
  protected readonly aboutLabel = MENTORSHIP_MENTOR_PROFILE_ABOUT_LABEL;
  protected readonly skillsLabel = MENTORSHIP_MENTOR_PROFILE_SKILLS_LABEL;
  protected readonly resumeLabel = MENTORSHIP_MENTOR_PROFILE_RESUME_LABEL;
  protected readonly aboutEmpty = MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY;
  protected readonly skillsEmpty = MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY;
  protected readonly resumeEmpty = MENTORSHIP_MENTOR_PROFILE_RESUME_EMPTY;

  protected readonly aboutMe = computed(() => this.profile().aboutMe.trim());
  protected readonly skills = computed(() => this.profile().skills);
  protected readonly resumeFileName = computed(() => this.profile().resumeFileName?.trim() ?? '');
  protected readonly resumeUrl = computed(() => this.profile().resumeUrl?.trim() ?? '');

  protected onEdit(): void {
    this.editClick.emit();
  }
}
