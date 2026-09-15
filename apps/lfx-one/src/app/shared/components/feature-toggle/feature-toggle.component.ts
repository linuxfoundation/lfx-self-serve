// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input, InputSignal, Signal } from '@angular/core';
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

  /**
   * The switch's accessible name, with the note folded in when there is one.
   * @description The note is the only place the row says why a toggle cannot be turned on yet, and
   * as plain text beside the control it never reaches a screen reader that walks the form by its
   * controls. Naming rather than describing it, because `lfx-toggle` wraps `p-toggleSwitch`, whose
   * only ARIA text input is `ariaLabel` — an `aria-describedby` bound out here would land on the
   * wrapper element rather than on the input the assistive technology actually focuses.
   */
  protected readonly toggleAriaLabel: Signal<string> = computed(() => {
    const note = this.toggleNote();
    return note ? `${this.feature().title}. ${note}` : this.feature().title;
  });
}
