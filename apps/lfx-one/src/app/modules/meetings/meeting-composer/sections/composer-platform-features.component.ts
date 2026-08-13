// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, output, Signal } from '@angular/core';
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
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { TooltipModule } from 'primeng/tooltip';
import { EMPTY, switchMap } from 'rxjs';

import { MeetingComposerFormService } from '../meeting-composer-form.service';

/**
 * Platform & Features section of the meeting composer (LFXV2-3237).
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
  private readonly formService = inject(MeetingComposerFormService);

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

  protected readonly titleLength: Signal<number> = this.initTitleLength();
  protected readonly platformError: Signal<boolean> = this.initPlatformError();

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

  private initTitleLength(): Signal<number> {
    return computed(() => {
      // `revision` bumps on every value change; a plain control read would not be reactive.
      this.formService.revision();
      return (this.form().get('title')?.value as string | null)?.length ?? 0;
    });
  }

  private initPlatformError(): Signal<boolean> {
    return computed(() => {
      this.formService.revision();
      const control = this.form().get('platform');
      return !!control?.errors?.['required'] && control.touched;
    });
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
