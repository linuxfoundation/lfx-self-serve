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
import { normalizeToUrl } from '@lfx-one/shared/utils';

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
  /**
   * The resume URL is server-supplied and gets bound to `[href]`. Angular's built-in
   * sanitiser catches the obvious `javascript:` case at render time, but the safer
   * posture is to allowlist the scheme up front — an unknown/bad URL degrades to the
   * non-link display (`resume-name`) rather than reaching the anchor at all.
   */
  protected readonly resumeUrl = computed(() => {
    const raw = this.profile().resumeUrl?.trim() ?? '';
    return raw && normalizeToUrl(raw) ? raw : '';
  });

  protected onEdit(): void {
    this.editClick.emit();
  }
}
