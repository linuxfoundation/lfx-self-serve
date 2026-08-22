// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, OnInit, output } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { InputNumberComponent } from '@components/input-number/input-number.component';
import { SelectComponent } from '@components/select/select.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
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
import { map, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-platform-features',
  imports: [ReactiveFormsModule, FeatureToggleComponent, InputNumberComponent, SelectComponent, ToggleComponent, TooltipModule],
  templateUrl: './meeting-platform-features.component.html',
})
export class MeetingPlatformFeaturesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  public readonly form = input.required<FormGroup>();
  public readonly goToTitleSection = output<void>();
  public readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  public readonly titleLength = toSignal(
    toObservable(this.form).pipe(
      switchMap((f) => {
        const ctrl = f.get('title');
        if (!ctrl) return of(0);
        return ctrl.valueChanges.pipe(
          startWith(ctrl.value as string | null),
          map((v: string | null) => v?.length ?? 0)
        );
      })
    ),
    { initialValue: 0 }
  );

  // Constants from shared package
  public readonly platformOptions = MEETING_PLATFORMS;
  public readonly artifactVisibilityOptions = ARTIFACT_VISIBILITY_OPTIONS;

  // Features for the two-column layout
  public readonly recordingFeature = MEETING_FEATURES.find((f) => f.key === 'recording_enabled')!;
  public readonly transcriptFeature = MEETING_FEATURES.find((f) => f.key === 'transcript_enabled')!;
  public readonly youtubeFeature = MEETING_FEATURES.find((f) => f.key === 'youtube_upload_enabled')!;
  public readonly aiSummaryFeature = MEETING_FEATURES.find((f) => f.key === 'zoom_ai_enabled')!;
  public readonly emailReminderFeature = EMAIL_REMINDER_FEATURE;
  public readonly emailReminderTooltip = EMAIL_REMINDER_TOOLTIP;

  // Transform platforms into dropdown options (only available platforms)
  public readonly platformDropdownOptions = MEETING_PLATFORMS.map((platform) => ({
    label: platform.available ? platform.label : `${platform.label} (Coming Soon)`,
    value: platform.value,
    icon: platform.icon,
    description: platform.description,
    disabled: !platform.available,
  }));

  public ngOnInit(): void {
    // Watch for recording_enabled changes to disable dependent features
    this.form()
      .get('recording_enabled')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((recordingEnabled: boolean) => {
        const dependentControls = ['transcript_enabled', 'youtube_upload_enabled'];

        dependentControls.forEach((controlName) => {
          const control = this.form().get(controlName);
          if (control) {
            if (!recordingEnabled) {
              // Disable and reset dependent features when recording is disabled
              control.setValue(false);
              control.disable();
            } else {
              // Re-enable dependent features when recording is enabled
              control.enable();
            }

            control.updateValueAndValidity();
          }
        });
      });

    // Watch the reminder toggle to enable/disable the hours and minutes inputs
    this.form()
      .get('auto_email_reminder_enabled')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reminderEnabled: boolean) => {
        const hoursControl = this.form().get('reminderHours');
        const minutesControl = this.form().get('reminderMinutes');
        if (!hoursControl || !minutesControl) {
          return;
        }

        if (reminderEnabled) {
          hoursControl.enable({ emitEvent: false });
          // Minutes stay locked at 0 while hours is at the 24-hour maximum
          if (Number(hoursControl.value) === MAX_EMAIL_REMINDER_HOURS) {
            minutesControl.setValue(DEFAULT_EMAIL_REMINDER_MINUTES, { emitEvent: false });
            minutesControl.disable({ emitEvent: false });
          } else {
            minutesControl.enable({ emitEvent: false });
          }
        } else {
          hoursControl.setValue(DEFAULT_EMAIL_REMINDER_HOURS, { emitEvent: false });
          hoursControl.disable({ emitEvent: false });
          minutesControl.setValue(DEFAULT_EMAIL_REMINDER_MINUTES, { emitEvent: false });
          minutesControl.disable({ emitEvent: false });
        }
      });

    // When set to 24 hours, minutes are automatically set to 0
    this.form()
      .get('reminderHours')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((hours) => {
        const minutesControl = this.form().get('reminderMinutes');
        if (!minutesControl || !this.form().get('auto_email_reminder_enabled')?.value) {
          return;
        }

        if (Number(hours) === MAX_EMAIL_REMINDER_HOURS) {
          minutesControl.setValue(DEFAULT_EMAIL_REMINDER_MINUTES, { emitEvent: false });
          minutesControl.disable({ emitEvent: false });
        } else {
          minutesControl.enable({ emitEvent: false });
        }
      });
  }

  public toggleFeature(featureKey: string, enabled: boolean): void {
    this.form().get(featureKey)?.setValue(enabled);
  }
}
