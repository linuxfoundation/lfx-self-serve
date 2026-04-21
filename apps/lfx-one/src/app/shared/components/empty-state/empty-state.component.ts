// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';

@Component({
  selector: 'lfx-empty-state',
  imports: [NgTemplateOutlet, CardComponent, ButtonComponent, RouterLink],
  templateUrl: './empty-state.component.html',
})
export class EmptyStateComponent {
  // === Inputs ===
  public readonly icon = input.required<string>();
  public readonly title = input.required<string>();
  public readonly subtitle = input<string>('');
  public readonly ctaLabel = input<string | undefined>(undefined);
  public readonly ctaRoute = input<string[] | undefined>(undefined);
  public readonly ctaIcon = input<string | undefined>(undefined);
  /** Set to false when the component is already inside a card-like container */
  public readonly withCard = input(true);

  // === Outputs ===
  public readonly ctaClick = output<void>();
}
