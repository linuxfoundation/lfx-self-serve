// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, SecurityContext, Signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import {
  getCountryByCode,
  MENTORSHIP_MENTEE_COUNTRY_LABEL,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_COUNTRY_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_DETAILS_TITLE,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_NOTES_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_NOTES_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { mentorshipDescriptionLength } from '@lfx-one/shared/utils';

/**
 * Read-only display of the mentee's own profile fields — About Me, Skills, Areas
 * to Improve, Additional Notes (`skill_set.comments`), Country (`address.country`) — as they appear on
 * `/mentorship/mentee/profile`. The parent owns load / error state and passes a
 * resolved `profile` in; this card just renders it. `editClick` is emitted rather
 * than routed so the parent decides whether Edit opens a drawer or fires the
 * coming-soon toast.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile-details',
  imports: [ButtonComponent],
  templateUrl: './mentee-profile-details.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileDetailsComponent {
  private readonly sanitizer = inject(DomSanitizer);

  public readonly profile = input.required<MentorshipMenteeProfileDetails>();
  public readonly editClick = output<void>();
  /** Defaults keep the profile tab copy. The apply page passes its own title and subtitle. */
  public readonly title = input(MENTORSHIP_MENTEE_PROFILE_DETAILS_TITLE);
  public readonly subtitle = input('');

  protected readonly editLabel = MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL;
  protected readonly aboutLabel = MENTORSHIP_MENTEE_PROFILE_ABOUT_LABEL;
  protected readonly skillsHaveLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_LABEL;
  protected readonly skillsWantLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_LABEL;
  protected readonly notesLabel = MENTORSHIP_MENTEE_PROFILE_NOTES_LABEL;
  protected readonly aboutEmpty = MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY;
  protected readonly skillsEmpty = MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY;
  protected readonly skillsWantEmpty = MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EMPTY;
  protected readonly notesEmpty = MENTORSHIP_MENTEE_PROFILE_NOTES_EMPTY;
  protected readonly countryLabel = MENTORSHIP_MENTEE_COUNTRY_LABEL;
  protected readonly countryEmpty = MENTORSHIP_MENTEE_PROFILE_COUNTRY_EMPTY;

  /**
   * `aboutMe` is authored in the register form via `lfx-rich-editor` (Quill under the
   * hood), so the upstream payload is HTML (`<p>…</p>`), not plain text. Two things
   * fall out of that:
   *   - Emptiness has to be decided on the stripped-tags value, not `raw.trim()` —
   *     the editor stores `<p></p>` for an empty answer, which is truthy under `.trim()`.
   *   - Rendering has to go through `[innerHTML]` after `DomSanitizer.sanitize`,
   *     otherwise the template interpolates the tags literally.
   * The length goes through `mentorshipDescriptionLength` so a stored value over the raw cap
   * skips the quadratic strip (lfx-self-serve-ops#37).
   */
  protected readonly aboutMeHtml = this.initAboutMeHtml();
  protected readonly aboutMeIsEmpty = computed(() => mentorshipDescriptionLength(this.aboutMeHtml()) === 0);
  protected readonly skillsHave = computed(() => this.profile().skillsHave);
  protected readonly skillsWant = computed(() => this.profile().skillsWant);
  protected readonly additionalNotes = computed(() => this.profile().additionalNotes?.trim() ?? '');
  /** The country name for the stored ISO code; a code outside `COUNTRIES` shows as stored. */
  protected readonly country = computed(() => {
    const code = this.profile().country?.trim() ?? '';
    return code ? getCountryByCode(code) : '';
  });

  protected onEdit(): void {
    this.editClick.emit();
  }

  private initAboutMeHtml(): Signal<string> {
    return computed(() => this.sanitizer.sanitize(SecurityContext.HTML, this.profile().aboutMe ?? '') ?? '');
  }
}
