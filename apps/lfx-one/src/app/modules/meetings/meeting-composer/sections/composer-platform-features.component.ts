// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  ARTIFACT_VISIBILITY_OPTIONS,
  DEFAULT_EMAIL_REMINDER_HOURS,
  DEFAULT_EMAIL_REMINDER_MINUTES,
  EMAIL_REMINDER_FEATURE,
  EMAIL_REMINDER_TOOLTIP,
  MAX_EMAIL_REMINDER_HOURS,
  MEETING_FEATURE_BY_KEY,
  MEETING_PLATFORMS,
  MIN_EMAIL_REMINDER_HOURS,
  RECORDING_DEPENDENCY_NOTES,
  REMINDER_MINUTES_ERROR_KEYS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { controlErrorSignal, controlValueSignal, touchedAnyErrorSignal, touchedErrorSignal } from '@shared/utils/form-control-signals.util';
import { TooltipModule } from 'primeng/tooltip';
import { EMPTY, switchMap } from 'rxjs';

/**
 * Platform & Features section of the meeting composer (GH-1456).
 * @description Owns `platform`, the four feature toggles, `require_ai_summary_approval`,
 * `artifact_visibility`, and the email reminder timing. The recording dependency wiring and the
 * YouTube title-length validator behaviour are unchanged from the wizard.
 */
@Component({
  selector: 'lfx-composer-platform-features',
  imports: [ReactiveFormsModule, CheckboxComponent, FeatureToggleComponent, InputNumberComponent, SelectButtonComponent, SelectComponent, TooltipModule],
  templateUrl: './composer-platform-features.component.html',
})
export class ComposerPlatformFeaturesComponent {
  public readonly form = input.required<FormGroup>();
  public readonly goToTitleSection = output<void>();

  protected readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  protected readonly artifactVisibilityOptions = ARTIFACT_VISIBILITY_OPTIONS;
  protected readonly emailReminderFeature = EMAIL_REMINDER_FEATURE;
  protected readonly emailReminderTooltip = EMAIL_REMINDER_TOOLTIP;

  protected readonly minReminderHours = MIN_EMAIL_REMINDER_HOURS;
  protected readonly maxReminderHours = MAX_EMAIL_REMINDER_HOURS;

  protected readonly recordingFeature = MEETING_FEATURE_BY_KEY.recording_enabled;
  protected readonly aiSummaryFeature = MEETING_FEATURE_BY_KEY.zoom_ai_enabled;
  protected readonly transcriptFeature = MEETING_FEATURE_BY_KEY.transcript_enabled;
  protected readonly youtubeFeature = MEETING_FEATURE_BY_KEY.youtube_upload_enabled;

  // Unavailable platforms stay listed but disabled, so the roadmap is visible without being pickable.
  protected readonly platformChipOptions = MEETING_PLATFORMS.map((platform) => ({
    label: platform.available ? platform.label : `${platform.label} (Coming Soon)`,
    value: platform.value,
    disabled: !platform.available,
  }));

  /*
   * Form state the template and the a11y attributes read, one named signal per control.
   *
   * Templates may only read signals, computed values and pipes — never `FormGroup.get()`
   * (`docs/reviews/frontend-checklist.md` section 4). These are built on `AbstractControl.events`
   * rather than on the form service's `revision()` counter, which is driven by `valueChanges` and
   * `statusChanges` and so never moves for a blur — see `form-control-signals.util.ts`.
   */
  protected readonly recordingEnabled: Signal<boolean | null> = controlValueSignal<boolean>(this.form, 'recording_enabled');
  protected readonly zoomAiEnabled: Signal<boolean | null> = controlValueSignal<boolean>(this.form, 'zoom_ai_enabled');
  protected readonly youtubeUploadEnabled: Signal<boolean | null> = controlValueSignal<boolean>(this.form, 'youtube_upload_enabled');
  protected readonly emailReminderEnabled: Signal<boolean | null> = controlValueSignal<boolean>(this.form, 'auto_email_reminder_enabled');
  /** Ungated on purpose: the YouTube callout answers a toggle the organizer has just flipped, not a blur. */
  protected readonly titleMaxlengthError: Signal<boolean> = controlErrorSignal(this.form, 'title', 'maxlength');
  protected readonly platformError: Signal<boolean> = touchedErrorSignal(this.form, 'platform', 'required');
  protected readonly reminderHoursRequiredError: Signal<boolean> = touchedErrorSignal(this.form, 'reminderHours', 'required');
  protected readonly reminderHoursPatternError: Signal<boolean> = touchedErrorSignal(this.form, 'reminderHours', 'pattern');
  protected readonly reminderHoursMinError: Signal<boolean> = touchedErrorSignal(this.form, 'reminderHours', 'min');
  protected readonly reminderHoursMaxError: Signal<boolean> = touchedErrorSignal(this.form, 'reminderHours', 'max');
  protected readonly reminderMinutesError: Signal<boolean> = touchedAnyErrorSignal(this.form, 'reminderMinutes', REMINDER_MINUTES_ERROR_KEYS);

  /** Recording is what the artifact-visibility select is about, so it appears with either producer. */
  protected readonly showArtifactVisibility: Signal<boolean> = computed(() => !!this.recordingEnabled() || !!this.zoomAiEnabled());

  private readonly titleValue: Signal<string | null> = controlValueSignal<string>(this.form, 'title');
  protected readonly titleLength: Signal<number> = computed(() => this.titleValue()?.length ?? 0);
  protected readonly transcriptNote: Signal<string | null> = this.initRecordingDependencyNote('transcript_enabled');
  protected readonly youtubeNote: Signal<string | null> = this.initRecordingDependencyNote('youtube_upload_enabled');

  public constructor() {
    // Every subscription is bridged through `form` so it re-binds when `initialize()` swaps the
    // FormGroup on a reopen — binding to the group present at construction would go stale.
    const form$ = toObservable(this.form);

    // Transcripts and YouTube upload both consume the recording, so they follow it on and off.
    form$
      .pipe(
        switchMap((form) => form.get('recording_enabled')?.valueChanges ?? EMPTY),
        takeUntilDestroyed()
      )
      .subscribe((recordingEnabled: boolean) => this.syncRecordingDependentControls(recordingEnabled));

    form$
      .pipe(
        switchMap((form) => form.get('auto_email_reminder_enabled')?.valueChanges ?? EMPTY),
        takeUntilDestroyed()
      )
      .subscribe((reminderEnabled: boolean) => this.syncReminderTimingControls(reminderEnabled));

    form$
      .pipe(
        switchMap((form) => form.get('reminderHours')?.valueChanges ?? EMPTY),
        takeUntilDestroyed()
      )
      .subscribe((hours) => this.syncReminderMinutesControl(Number(hours)));
  }

  /**
   * Why a recording-gated toggle is off, or `null` once recording is on.
   * @description `syncRecordingDependentControls` disables these two controls whenever recording is
   * off, so the note appears exactly while its toggle can't be used.
   */
  private initRecordingDependencyNote(key: keyof typeof RECORDING_DEPENDENCY_NOTES): Signal<string | null> {
    return computed(() => (this.recordingEnabled() ? null : RECORDING_DEPENDENCY_NOTES[key]));
  }

  private syncRecordingDependentControls(recordingEnabled: boolean): void {
    [this.transcriptFeature.key, this.youtubeFeature.key].forEach((controlName) => {
      const control = this.form().get(controlName);

      if (!control) {
        return;
      }

      if (recordingEnabled) {
        control.enable();
        return;
      }

      control.setValue(false);
      control.disable();
    });
  }

  private syncReminderTimingControls(reminderEnabled: boolean): void {
    const hoursControl = this.form().get('reminderHours');
    const minutesControl = this.form().get('reminderMinutes');

    if (!hoursControl || !minutesControl) {
      return;
    }

    if (!reminderEnabled) {
      hoursControl.setValue(DEFAULT_EMAIL_REMINDER_HOURS, { emitEvent: false });
      hoursControl.disable({ emitEvent: false });
      minutesControl.setValue(DEFAULT_EMAIL_REMINDER_MINUTES, { emitEvent: false });
      minutesControl.disable({ emitEvent: false });
      return;
    }

    hoursControl.enable({ emitEvent: false });
    this.syncReminderMinutesControl(Number(hoursControl.value));
  }

  private syncReminderMinutesControl(hours: number): void {
    const minutesControl = this.form().get('reminderMinutes');

    if (!minutesControl || !this.form().get('auto_email_reminder_enabled')?.value) {
      return;
    }

    // Minutes stay locked at 0 while hours sits at the 24-hour maximum.
    if (hours === MAX_EMAIL_REMINDER_HOURS) {
      minutesControl.setValue(DEFAULT_EMAIL_REMINDER_MINUTES, { emitEvent: false });
      minutesControl.disable({ emitEvent: false });
    } else {
      minutesControl.enable({ emitEvent: false });
    }
  }
}
