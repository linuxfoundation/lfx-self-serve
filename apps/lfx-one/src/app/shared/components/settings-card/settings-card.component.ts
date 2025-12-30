// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, input } from '@angular/core';

@Component({
  selector: 'lfx-settings-card',
  imports: [NgClass],
  templateUrl: './settings-card.component.html',
})
export class SettingsCardComponent {
  public readonly icon = input.required<string>();
  public readonly iconColorClass = input.required<string>();
  public readonly iconBgClass = input.required<string>();
  public readonly title = input.required<string>();
  public readonly description = input.required<string>();
  public readonly testId = input<string>('');
}
