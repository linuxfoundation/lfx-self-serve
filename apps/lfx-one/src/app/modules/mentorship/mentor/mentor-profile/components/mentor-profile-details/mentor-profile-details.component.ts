// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY,
  MENTORSHIP_MENTOR_PROFILE_ABOUT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_DETAILS_TITLE,
  MENTORSHIP_MENTOR_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY,
  MENTORSHIP_MENTOR_PROFILE_SKILLS_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails } from '@lfx-one/shared/interfaces';
import { mentorshipDescriptionLength } from '@lfx-one/shared/utils';

/**
 * Read-only display of the mentor's own profile fields — About Me and Skills —
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
  protected readonly aboutEmpty = MENTORSHIP_MENTOR_PROFILE_ABOUT_EMPTY;
  protected readonly skillsEmpty = MENTORSHIP_MENTOR_PROFILE_SKILLS_EMPTY;

  /**
   * `aboutMe` is authored in the register form via `lfx-rich-editor` (Quill under the
   * hood), so the upstream payload is HTML (`<p>…</p>`), not plain text. Two things
   * fall out of that:
   *   - Emptiness has to be decided on the stripped-tags value, not `raw.trim()` —
   *     the editor stores `<p></p>` for an empty answer, which is truthy under `.trim()`.
   *   - Rendering has to go through `[innerHTML]` (Angular sanitises on the way in),
   *     otherwise the template interpolates the tags literally.
   * The length goes through `mentorshipDescriptionLength` so a stored value over the raw cap
   * skips the quadratic strip (lfx-self-serve-ops#37).
   */
  protected readonly aboutMeHtml = computed(() => this.profile().aboutMe ?? '');
  protected readonly aboutMeIsEmpty = computed(() => mentorshipDescriptionLength(this.aboutMeHtml()) === 0);
  protected readonly skills = computed(() => this.profile().skills);

  protected onEdit(): void {
    this.editClick.emit();
  }
}
