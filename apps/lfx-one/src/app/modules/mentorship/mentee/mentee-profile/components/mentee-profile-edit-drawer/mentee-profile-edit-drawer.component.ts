// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_INTRO,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS,
  MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_RESUME_COMING_SOON_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL,
  MENTORSHIP_MENTEE_RESUME_INTRO,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import {
  buildMentorshipMenteeProfileUpdate,
  capCodePointEdit,
  codePointLength,
  htmlClipboardToText,
  isMentorshipMenteeProfileUpdateEmpty,
  isMentorshipRichTextOverRawMax,
  mentorshipPlainTextToHtml,
  normalizeToUrl,
} from '@lfx-one/shared/utils';
import { maxCodePointsValidator } from '@lfx-one/shared/validators';
import { DrawerModule } from 'primeng/drawer';
import { filter, merge, startWith } from 'rxjs';

import { ResumeSectionComponent } from '../../../../components/resume-section/resume-section.component';
import { SkillsPickerComponent } from '../../../../components/skills-picker/skills-picker.component';
import { MenteeProfileSaveService } from '../../../../services/mentee-profile-save.service';
import { MenteeProfileEditDrawerService } from './mentee-profile-edit-drawer.service';

/** Angular `minLength` skips empty values, so `[]` would otherwise pass as valid. */
function requiredStringList(): ValidatorFn {
  return (control) => (Array.isArray(control.value) && control.value.length > 0 ? null : { required: true });
}

/** Rejects a list with too many skills or a skill that is too long; the BFF enforces the same caps. */
function boundedStringList(): ValidatorFn {
  return (control) => {
    const value: unknown = control.value;
    if (!Array.isArray(value)) return null;
    const tooLong = value.some((item) => typeof item === 'string' && item.trim().length > MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH);
    return value.length > MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS || tooLong ? { boundedList: true } : null;
  };
}

/**
 * Right-side mentee profile edit drawer, opened from the "Edit Mentee Profile" button
 * on the standalone mentee profile page. Fields map to `user_profiles`: About Me ←
 * `introduction`, skills ← `skill_set.skills` / `improvementSkills`, additional notes
 * ← `skill_set.comments`, resume filename as display-only from `profile_links.resumeLink`.
 *
 * Save sends only the groups the mentee changed (see `buildMentorshipMenteeProfileUpdate`) and
 * emits `saved` with the response, so the host can show it in place. The resume is display-only:
 * its Browse and Clear show the coming-soon toast, and it never enters the request. On a failure
 * the drawer stays open with the mentee's input and shows the message inline.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile-edit-drawer',
  imports: [DrawerModule, ButtonComponent, TextareaComponent, SkillsPickerComponent, ResumeSectionComponent],
  templateUrl: './mentee-profile-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenteeProfileEditDrawerComponent {
  private readonly saveService = inject(MenteeProfileSaveService);
  private readonly drawer = inject(MenteeProfileEditDrawerService);
  private readonly injector = inject(Injector);
  private readonly errorRef = viewChild<ElementRef<HTMLElement>>('errorRef');
  protected readonly isOpen = this.drawer.isOpen;
  protected readonly saving = this.saveService.saving;

  /** Emits the saved profile once the update succeeds, just before the drawer closes. */
  public readonly saved = output<MentorshipMenteeProfileUpdateResponse>();

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
  protected readonly resumeComingSoonSummary = MENTORSHIP_MENTEE_PROFILE_RESUME_COMING_SOON_SUMMARY;

  // Code-point cap (not Validators.maxLength, which counts UTF-16 units). Native maxlength
  // is omitted on the About Me textarea for the same reason.
  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true, validators: [maxCodePointsValidator(MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX)] }),
    skillsHave: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList(), boundedStringList()] }),
    skillsWant: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList(), boundedStringList()] }),
    additionalNotes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX)] }),
    resumeFileName: new FormControl('', { nonNullable: true }),
  });

  protected readonly aboutMeLength = signal(0);
  /** The message for the last failed Save, shown inline. Cleared on the next Save, on any edit and on re-seed. */
  protected readonly errorMessage = signal('');
  private lastValidIntroduction = '';
  private seededIntroduction = '';
  private seedProfile: MentorshipMenteeProfileDetails | null = null;
  private readonly saveAttempted = signal(false);
  // Per-control ticks: parent `form.statusChanges` does not emit when overall
  // status stays INVALID, so filling one required picker would leave its error up.
  private readonly skillPickerTick = toSignal(
    merge(
      this.form.controls.skillsHave.statusChanges,
      this.form.controls.skillsHave.valueChanges,
      this.form.controls.skillsWant.statusChanges,
      this.form.controls.skillsWant.valueChanges
    ).pipe(startWith(null)),
    { initialValue: null }
  );

  protected readonly skillsHaveError = computed(() => this.skillPickerError('skillsHave', 'Add at least one skill you currently have.'));
  protected readonly skillsWantError = computed(() => this.skillPickerError('skillsWant', 'Add at least one skill you would like to improve.'));

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => this.seedForm(profile));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.errorMessage.set(''));

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
    if (this.saving()) {
      return;
    }

    this.errorMessage.set('');
    this.form.markAllAsTouched();
    this.saveAttempted.set(true);
    const profile = this.seedProfile;
    if (this.form.invalid || !profile) {
      return;
    }

    const request = buildMentorshipMenteeProfileUpdate(profile, this.seededIntroduction, this.form.getRawValue());
    if (isMentorshipMenteeProfileUpdateEmpty(request)) {
      this.drawer.close();
      return;
    }

    // The BFF escapes the text into paragraphs, which can outgrow the raw cap for a long, markup-heavy
    // or blank-line-heavy introduction. Say so here rather than round-trip a 400.
    if (request.introduction !== undefined && isMentorshipRichTextOverRawMax(mentorshipPlainTextToHtml(request.introduction))) {
      this.showError(MENTORSHIP_MENTEE_PROFILE_ABOUT_HTML_TOO_LONG_MESSAGE);
      return;
    }

    this.saveService.save(request, MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY).subscribe({
      next: (response) => {
        this.saved.emit(response);
        this.drawer.close();
      },
      error: (err: unknown) => this.showError(this.saveService.errorMessage(err)),
    });
  }

  protected onCancel(): void {
    if (this.saving()) {
      return;
    }
    this.drawer.close();
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible && !this.saving()) {
      this.drawer.close();
    }
  }

  /**
   * Shows the message and moves focus to it once rendered: the disabled Save button drops focus while
   * saving, and the alert can sit below the fold of a long form. `afterNextRender` never runs on the server.
   */
  private showError(message: string): void {
    this.errorMessage.set(message);
    afterNextRender(() => this.errorRef()?.nativeElement.focus(), { injector: this.injector });
  }

  private seedForm(profile: MentorshipMenteeProfileDetails): void {
    // Register and the drawer share the 3000 code-point cap. Convert block boundaries
    // to newlines, then cap, *before* patching so the control, counter, and baselines
    // share one value. patchValue must emit so skills pickers and the resume section
    // (which snapshot `valueChanges`) pick up the seeded skills and filename.
    const introduction = capCodePointEdit('', htmlClipboardToText(this.boundStoredAboutMe(profile.aboutMe ?? '')), MENTORSHIP_MENTEE_PROFILE_ABOUT_MAX);
    this.lastValidIntroduction = introduction;
    this.seededIntroduction = introduction;
    this.seedProfile = profile;
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
    this.errorMessage.set('');
  }

  /**
   * The stored `aboutMe` comes from the API, so it is cut to the raw cap before
   * `htmlClipboardToText`, whose tag strip is quadratic on adversarial input
   * (lfx-self-serve-ops#37). A cut can land inside a surrogate pair, a tag or an entity,
   * which the converter would keep as a stray `�` or literal text, so a trailing partial one
   * is dropped. The editor escapes a typed `<` and `&` as `&lt;` and `&amp;`, so a raw `<`
   * after the last `>`, or a trailing `&` with no `;`, can only be something the cut split.
   */
  private boundStoredAboutMe(html: string): string {
    if (html.length <= MENTORSHIP_RICH_TEXT_RAW_MAX) return html;
    const lastUnit = html.charCodeAt(MENTORSHIP_RICH_TEXT_RAW_MAX - 1);
    const splitsPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
    const sliced = html.slice(0, splitsPair ? MENTORSHIP_RICH_TEXT_RAW_MAX - 1 : MENTORSHIP_RICH_TEXT_RAW_MAX);
    const lastOpen = sliced.lastIndexOf('<');
    const tagSafe = lastOpen > sliced.lastIndexOf('>') ? sliced.slice(0, lastOpen) : sliced;
    return tagSafe.replace(/&#?\w*$/, '');
  }

  private skillPickerError(control: 'skillsHave' | 'skillsWant', message: string): string | undefined {
    this.skillPickerTick();
    this.saveAttempted();
    const field = this.form.controls[control];
    if (!field.touched || field.valid) return undefined;
    return field.hasError('boundedList') ? MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE : message;
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
