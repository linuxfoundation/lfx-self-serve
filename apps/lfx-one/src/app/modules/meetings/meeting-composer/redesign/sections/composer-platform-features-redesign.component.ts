// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, type Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MEETING_PLATFORM_SOON_SUFFIX, MEETING_PLATFORMS, RECORDING_REQUIRED_NOTE } from '@lfx-one/shared/constants';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiErrorComponent } from '@shared/uikit/error/error.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';

import { ComposerPlatformFeaturesComponent } from '../../sections/composer-platform-features.component';

/**
 * Platform & features section of the redesigned meeting composer.
 * @description Extends the drawer's section so the recording dependencies, reminder range and validators stay shared.
 * Adds the redesign's copy: one recording note for dependent features, a label for what the artifact setting covers,
 * and a single reminder range error.
 */
@Component({
  selector: 'lfx-composer-platform-features-redesign',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    UiBadgeComponent,
    UiCheckboxComponent,
    UiErrorComponent,
    UiInputComponent,
    UiOptionComponent,
    UiSelectComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
    UiToggleComponent,
  ],
  templateUrl: './composer-platform-features-redesign.component.html',
})
export class ComposerPlatformFeaturesRedesignComponent extends ComposerPlatformFeaturesComponent {
  protected readonly platforms = MEETING_PLATFORMS.map((platform) => ({
    ...platform,
    label: platform.available ? platform.label : platform.label + MEETING_PLATFORM_SOON_SUFFIX,
  }));
  protected readonly recordingNote: Signal<string | null> = computed(() => (this.recordingEnabled() ? null : RECORDING_REQUIRED_NOTE));
  protected readonly artifactVisibilityLabel: Signal<string> = this.initArtifactVisibilityLabel();
  protected readonly reminderError: Signal<string> = this.initReminderError();

  private initArtifactVisibilityLabel(): Signal<string> {
    return computed(() => {
      if (this.recordingEnabled() && this.zoomAiEnabled()) {
        return 'Who can access recordings & summaries';
      }
      return this.recordingEnabled() ? 'Who can access recordings' : 'Who can access summaries';
    });
  }

  /** One sentence for every reminder failure: the API takes 2 to 24 hours, and minutes only below 24. */
  private initReminderError(): Signal<string> {
    return computed(() => {
      if (this.reminderHoursRequiredError() || this.reminderHoursPatternError() || this.reminderHoursMinError() || this.reminderHoursMaxError()) {
        return `Set the reminder to a whole number of hours between ${this.minReminderHours} and ${this.maxReminderHours}.`;
      }
      return this.reminderMinutesError() ? `Minutes must be a whole number between ${this.minReminderMinutes} and ${this.maxReminderMinutes}.` : '';
    });
  }
}
