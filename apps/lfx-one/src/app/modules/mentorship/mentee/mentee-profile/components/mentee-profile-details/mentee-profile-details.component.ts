// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, output, SecurityContext, Signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ButtonComponent } from '@components/button/button.component';
import {
  MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_DETAILS_TITLE,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_NOTES_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_NOTES_LABEL,
  MENTORSHIP_MENTEE_PROFILE_RESUME_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_RESUME_LABEL,
  MENTORSHIP_MENTEE_PROFILE_RESUME_VIEW_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EMPTY,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails } from '@lfx-one/shared/interfaces';
import { normalizeToUrl, stripHtml } from '@lfx-one/shared/utils';

/**
 * Read-only display of the mentee's own profile fields — About Me, Skills, Areas
 * to Improve, Additional Notes (`skill_set.comments`), Resume (`profile_links.resumeLink`)
 * — as they appear on `/mentorship/mentee/profile`. The parent owns load / error
 * state and passes a resolved `profile` in; this card just renders it. `editClick`
 * is emitted rather than routed so the parent decides whether Edit opens a drawer
 * or fires the coming-soon toast.
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
  protected readonly resumeLabel = MENTORSHIP_MENTEE_PROFILE_RESUME_LABEL;
  protected readonly resumeViewLabel = MENTORSHIP_MENTEE_PROFILE_RESUME_VIEW_LABEL;
  protected readonly aboutEmpty = MENTORSHIP_MENTEE_PROFILE_ABOUT_EMPTY;
  protected readonly skillsEmpty = MENTORSHIP_MENTEE_PROFILE_SKILLS_EMPTY;
  protected readonly skillsWantEmpty = MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EMPTY;
  protected readonly notesEmpty = MENTORSHIP_MENTEE_PROFILE_NOTES_EMPTY;
  protected readonly resumeEmpty = MENTORSHIP_MENTEE_PROFILE_RESUME_EMPTY;

  /**
   * `aboutMe` is authored in the register form via `lfx-rich-editor` (Quill under the
   * hood), so the upstream payload is HTML (`<p>…</p>`), not plain text. Two things
   * fall out of that:
   *   - Emptiness has to be decided on the stripped-tags value, not `raw.trim()` —
   *     the editor stores `<p></p>` for an empty answer, which is truthy under `.trim()`.
   *   - Rendering has to go through `[innerHTML]` after `DomSanitizer.sanitize`,
   *     otherwise the template interpolates the tags literally.
   */
  protected readonly aboutMeHtml = this.initAboutMeHtml();
  protected readonly aboutMeIsEmpty = computed(() => stripHtml(this.aboutMeHtml()).length === 0);
  protected readonly skillsHave = computed(() => this.profile().skillsHave);
  protected readonly skillsWant = computed(() => this.profile().skillsWant);
  protected readonly additionalNotes = computed(() => this.profile().additionalNotes?.trim() ?? '');
  protected readonly resumeFileName = computed(() => this.profile().resumeFileName?.trim() ?? '');
  /**
   * The resume URL is server-supplied and gets bound to `[href]`. `normalizeToUrl`
   * (a) allow-lists `http(s)` — an unknown/bad URL degrades to the non-link display
   * (`resume-name`) rather than reaching the anchor at all — and (b) upgrades a
   * bare host (e.g. `example.com/resume.pdf`) to `https://…`. Returning the
   * normalized value rather than the raw input is load-bearing: a scheme-less
   * value bound to `[href]` would otherwise resolve as an in-app relative path.
   */
  protected readonly resumeUrl = this.initResumeUrl();
  /**
   * The profile contract lets `resumeFileName` and `resumeUrl` be present
   * independently, so the empty state has to be `neither`, not `no filename`.
   */
  protected readonly hasResume = computed(() => Boolean(this.resumeFileName() || this.resumeUrl()));
  protected readonly resumeLinkLabel = computed(() => this.resumeFileName() || this.resumeViewLabel);

  protected onEdit(): void {
    this.editClick.emit();
  }

  private initAboutMeHtml(): Signal<string> {
    return computed(() => this.sanitizer.sanitize(SecurityContext.HTML, this.profile().aboutMe ?? '') ?? '');
  }

  private initResumeUrl(): Signal<string> {
    return computed(() => {
      const raw = this.profile().resumeUrl?.trim() ?? '';
      if (!raw) return '';
      return normalizeToUrl(raw) ?? '';
    });
  }
}
