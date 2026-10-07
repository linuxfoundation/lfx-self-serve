// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ValidatorFn, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  COUNTRIES,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX,
  MENTORSHIP_MENTEE_COUNTRY_INTRO,
  MENTORSHIP_MENTEE_COUNTRY_LABEL,
  MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER,
  MENTORSHIP_MENTEE_COUNTRY_TITLE,
  MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_INTRO,
  MENTORSHIP_MENTEE_PROFILE_ABOUT_PROMPTS,
  MENTORSHIP_MENTEE_PROFILE_CANCEL_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_EDIT_SUBTITLE,
  MENTORSHIP_MENTEE_PROFILE_SAVE_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_PROFILE_SKILL_MAX_LENGTH,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_MAX_ITEMS,
  MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeProfileDetails, MentorshipMenteeProfileUpdateResponse } from '@lfx-one/shared/interfaces';
import {
  buildMentorshipMenteeProfileUpdate,
  getMentorshipMenteeCountryError,
  getMentorshipMenteeIntroductionError,
  isMentorshipMenteeProfileUpdateEmpty,
} from '@lfx-one/shared/utils';
import { DrawerModule } from 'primeng/drawer';
import { filter, merge, startWith } from 'rxjs';

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

/** The register rule for the country (`getMentorshipMenteeCountryError`), so the drawer, the form and the BFF agree. */
function mentorshipCountry(): ValidatorFn {
  return (control) => (getMentorshipMenteeCountryError(typeof control.value === 'string' ? control.value : '') ? { country: true } : null);
}

/**
 * Right-side mentee profile edit drawer, opened from the "Edit Mentee Profile" button
 * on the standalone mentee profile page. Fields map to `user_profiles`: About Me ←
 * `introduction`, skills ← `skill_set.skills` / `improvementSkills`, additional notes
 * ← `skill_set.comments`, country ← `address.country`. About Me uses the register form's rich editor and rule, so the stored HTML
 * round-trips unchanged.
 *
 * Save sends only the groups the mentee changed (see `buildMentorshipMenteeProfileUpdate`) and
 * emits `saved` with the response, so the host can show it in place. On a failure the drawer stays open with the mentee's input and shows the message inline.
 */
@Component({
  selector: 'lfx-mentorship-mentee-profile-edit-drawer',
  imports: [DrawerModule, ButtonComponent, RichEditorComponent, SelectComponent, TextareaComponent, SkillsPickerComponent],
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
  protected readonly introductionPlaceholder = MENTORSHIP_MENTEE_INTRODUCTION_PLACEHOLDER;
  protected readonly skillsIntro = MENTORSHIP_MENTEE_PROFILE_SKILLS_INTRO;
  protected readonly skillsHaveLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_HAVE_EDIT_LABEL;
  protected readonly skillsWantLabel = MENTORSHIP_MENTEE_PROFILE_SKILLS_WANT_EDIT_LABEL;
  protected readonly additionalNotesLabel = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL;
  protected readonly additionalNotesMax = MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX;
  protected readonly countryTitle = MENTORSHIP_MENTEE_COUNTRY_TITLE;
  protected readonly countryIntro = MENTORSHIP_MENTEE_COUNTRY_INTRO;
  protected readonly countryLabel = MENTORSHIP_MENTEE_COUNTRY_LABEL;
  protected readonly countryPlaceholder = MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER;
  protected readonly countryOptions = [...COUNTRIES];

  // The introduction is checked by `getMentorshipMenteeIntroductionError` on Save rather than by a validator,
  // so a stored introduction the mentee leaves untouched never blocks a skills-only save. The country is required,
  // as on register, so a profile saved before the field existed must pick one on its next save.
  protected readonly form = new FormGroup({
    introduction: new FormControl('', { nonNullable: true }),
    skillsHave: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList(), boundedStringList()] }),
    skillsWant: new FormControl<string[]>([], { nonNullable: true, validators: [requiredStringList(), boundedStringList()] }),
    additionalNotes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_MAX)] }),
    country: new FormControl('', { nonNullable: true, validators: [mentorshipCountry()] }),
  });

  /** The message for the last failed Save, shown inline. Cleared on the next Save, on any edit and on re-seed. */
  protected readonly errorMessage = signal('');
  private readonly seedProfile = signal<MentorshipMenteeProfileDetails | null>(null);
  private readonly saveAttempted = signal(false);
  private readonly introductionValue = toSignal(this.form.controls.introduction.valueChanges, { initialValue: '' });
  private readonly countryValue = toSignal(this.form.controls.country.valueChanges, { initialValue: '' });
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
  /** Shown after a Save attempt, and updated as the mentee picks. */
  protected readonly countryError = computed(() => (this.saveAttempted() ? getMentorshipMenteeCountryError(this.countryValue()) : undefined));
  /** Shown after a Save attempt, and only for an edited introduction: the stored one is never sent unless changed. */
  protected readonly introductionError = computed(() => {
    const introduction = this.introductionValue();
    const seed = this.seedProfile();
    if (!this.saveAttempted() || !seed || introduction === (seed.aboutMe ?? '')) return undefined;
    return getMentorshipMenteeIntroductionError(introduction);
  });

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(filter(Boolean), takeUntilDestroyed())
      .subscribe((profile) => this.seedForm(profile));

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.errorMessage.set(''));
  }

  protected onSave(): void {
    if (this.saving()) {
      return;
    }

    this.errorMessage.set('');
    this.form.markAllAsTouched();
    this.saveAttempted.set(true);
    const profile = this.seedProfile();
    if (this.form.invalid || !profile) {
      return;
    }

    const request = buildMentorshipMenteeProfileUpdate(profile, this.form.getRawValue());
    if (isMentorshipMenteeProfileUpdateEmpty(request)) {
      this.drawer.close();
      return;
    }

    // The same rule the BFF applies; `introductionError` already shows the message under the editor.
    if (request.introduction !== undefined && getMentorshipMenteeIntroductionError(request.introduction)) {
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
    // The stored HTML seeds the editor as is, so an untouched introduction equals `aboutMe` and is not sent.
    // patchValue must emit so the skills pickers (which snapshot `valueChanges`) pick up the seeded skills.
    this.seedProfile.set(profile);
    this.saveAttempted.set(false);
    this.form.patchValue({
      introduction: profile.aboutMe ?? '',
      skillsHave: profile.skillsHave ?? [],
      skillsWant: profile.skillsWant ?? [],
      additionalNotes: profile.additionalNotes ?? '',
      country: profile.country ?? '',
    });
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.errorMessage.set('');
  }

  private skillPickerError(control: 'skillsHave' | 'skillsWant', message: string): string | undefined {
    this.skillPickerTick();
    this.saveAttempted();
    const field = this.form.controls[control];
    if (!field.touched || field.valid) return undefined;
    return field.hasError('boundedList') ? MENTORSHIP_MENTEE_PROFILE_SKILLS_LIMIT_MESSAGE : message;
  }
}
