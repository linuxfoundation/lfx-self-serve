// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input, InputSignal } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { FeatureConfig } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-feature-toggle',
  imports: [ToggleComponent, NgClass],
  templateUrl: './feature-toggle.component.html',
})
export class FeatureToggleComponent {
  public readonly feature: InputSignal<FeatureConfig> = input.required<FeatureConfig>();
  public readonly form: InputSignal<FormGroup> = input.required<FormGroup>();
  public readonly comingSoon = input<boolean>(false);
  /**
   * Renders as a row of an enclosing outlined list instead of as a card of its own.
   * @description The composer's Platform & Features step draws its toggles as one attached list — the
   * same treatment the Details & Access visibility and join-restriction options get — so the row drops
   * its own border and corners and lets the container own the outline and the hairlines between rows.
   * Standalone uses (the recurrence card, show-attendees) leave this off and keep the card.
   */
  public readonly attached = input<boolean>(false);
  /**
   * Short italic note shown beside the toggle — typically why the toggle cannot be turned on yet.
   * @description Sits in the row rather than under it, so the reason reads against the control it
   * belongs to instead of against the card as a whole. `null` renders nothing.
   */
  public readonly toggleNote = input<string | null>(null);
}
