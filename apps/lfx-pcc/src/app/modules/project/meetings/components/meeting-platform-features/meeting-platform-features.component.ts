// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectComponent } from '@components/select/select.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { AI_SUMMARY_ACCESS_OPTIONS, MEETING_FEATURES, MEETING_PLATFORMS, RECORDING_ACCESS_OPTIONS } from '@lfx-pcc/shared/constants';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-meeting-platform-features',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SelectComponent, ToggleComponent, TooltipModule],
  templateUrl: './meeting-platform-features.component.html',
})
export class MeetingPlatformFeaturesComponent {
  // Form group input from parent
  public readonly form = input.required<FormGroup>();

  // Constants from shared package
  public readonly platformOptions = MEETING_PLATFORMS;
  public readonly features = MEETING_FEATURES;
  public readonly recordingAccessOptions = RECORDING_ACCESS_OPTIONS;
  public readonly aiSummaryAccessOptions = AI_SUMMARY_ACCESS_OPTIONS;

  public selectPlatform(platform: string): void {
    const platformOption = this.platformOptions.find((p) => p.value === platform);
    if (platformOption?.available) {
      this.form().get('meetingTool')?.setValue(platform);
    }
  }

  public toggleFeature(featureKey: string, enabled: boolean): void {
    this.form().get(featureKey)?.setValue(enabled);
  }
}
