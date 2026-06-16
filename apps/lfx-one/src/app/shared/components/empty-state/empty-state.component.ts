// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonProps } from '@lfx-one/shared/interfaces';

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
  /** External-link CTA URL; rendered as an anchor button when set and no ctaRoute is provided (ctaRoute takes precedence). */
  public readonly ctaHref = input<string | undefined>(undefined);
  public readonly ctaTarget = input<string>('_self');
  public readonly ctaRel = input<string | undefined>(undefined);
  /** Render the href/click CTA as a text (ghost) button instead of outlined. */
  public readonly ctaGhost = input(false);
  public readonly ctaSize = input<ButtonProps['size']>('small');
  /** Set to false when the component is already inside a card-like container */
  public readonly withCard = input(true);

  // === Outputs ===
  public readonly ctaClick = output<void>();

  /** Defaults rel to `noopener noreferrer` for `_blank` targets to prevent reverse-tabnabbing. Treats empty/whitespace ctaRel as not provided. */
  protected readonly resolvedRel = computed(() => {
    const rel = this.ctaRel()?.trim();
    if (rel) return rel;
    return this.ctaTarget() === '_blank' ? 'noopener noreferrer' : undefined;
  });
}
