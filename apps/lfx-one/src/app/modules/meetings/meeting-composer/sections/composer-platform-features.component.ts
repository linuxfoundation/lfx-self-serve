// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, OnInit, output, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  MEETING_FEATURES,
  MEETING_PLATFORMS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { TooltipModule } from 'primeng/tooltip';

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
export class ComposerPlatformFeaturesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly formService = inject(MeetingComposerFormService);

  public readonly form = input.required<FormGroup>();
  public readonly goToTitleSection = output<void>();

  protected readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  protected readonly artifactVisibilityOptions = ARTIFACT_VISIBILITY_OPTIONS;
  protected readonly emailReminderFeature = EMAIL_REMINDER_FEATURE;
  protected readonly emailReminderTooltip = EMAIL_REMINDER_TOOLTIP;

  protected readonly recordingFeature = MEETING_FEATURES.find((feature) => feature.key === 'recording_enabled')!;
  protected readonly aiSummaryFeature = MEETING_FEATURES.find((feature) => feature.key === 'zoom_ai_enabled')!;
  protected readonly transcriptFeature = MEETING_FEATURES.find((feature) => feature.key === 'transcript_enabled')!;
  protected readonly youtubeFeature = MEETING_FEATURES.find((feature) => feature.key === 'youtube_upload_enabled')!;

  // Unavailable platforms stay listed but disabled, so the roadmap is visible without being pickable.
  protected readonly platformChipOptions = MEETING_PLATFORMS.map((platform) => ({
    label: platform.available ? platform.label : `${platform.label} (Coming Soon)`,
    value: platform.value,
    disabled: !platform.available,
  }));

  protected readonly titleLength: Signal<number> = this.initTitleLength();

  public ngOnInit(): void {
    // Transcripts and YouTube upload both consume the recording, so they follow it on and off.
    this.form()
      .get('recording_enabled')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recordingEnabled: boolean) => {
        ['transcript_enabled', 'youtube_upload_enabled'].forEach((controlName) => {
          const control = this.form().get(controlName);

          if (!control) {
            return;
          }

          if (recordingEnabled) {
            control.enable();
          } else {
            control.setValue(false);
            control.disable();
          }

          control.updateValueAndValidity();
        });
      });

    this.form()
      .get('auto_email_reminder_enabled')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reminderEnabled: boolean) => this.syncReminderTimingControls(reminderEnabled));

    this.form()
      .get('reminderHours')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((hours) => this.syncReminderMinutesControl(Number(hours)));
  }

  private initTitleLength(): Signal<number> {
    return computed(() => {
      // `revision` bumps on every value change; a plain control read would not be reactive.
      this.formService.revision();
      return (this.form().get('title')?.value as string | null)?.length ?? 0;
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
