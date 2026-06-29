// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, DestroyRef, inject, input, OnInit, output } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FeatureToggleComponent } from '@components/feature-toggle/feature-toggle.component';
import { SelectComponent } from '@components/select/select.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import {
  ARTIFACT_VISIBILITY_OPTIONS,
  MEETING_DETAILS_STEP,
  MEETING_FEATURES,
  MEETING_PLATFORMS,
  YOUTUBE_MAX_MEETING_TITLE_LENGTH,
} from '@lfx-one/shared/constants';
import { TooltipModule } from 'primeng/tooltip';
import { map, of, startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-platform-features',
  imports: [ReactiveFormsModule, FeatureToggleComponent, SelectComponent, ToggleComponent, TooltipModule],
  templateUrl: './meeting-platform-features.component.html',
})
export class MeetingPlatformFeaturesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  public readonly form = input.required<FormGroup>();
  public readonly goToStep = output<number>();
  public readonly youtubeTitleLimit = YOUTUBE_MAX_MEETING_TITLE_LENGTH;
  public readonly meetingDetailsStep = MEETING_DETAILS_STEP;
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
  public readonly calendarFeature = MEETING_FEATURES.find((f) => f.key === 'visibility')!;

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
  }

  public toggleFeature(featureKey: string, enabled: boolean): void {
    this.form().get(featureKey)?.setValue(enabled);
  }
}
