// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, TemplateRef } from '@angular/core';
import { ProfilePillTile } from '@lfx-one/shared/interfaces';
import { UiHoverCardDirective } from '@shared/uikit/hover-card/hover-card.directive';

/**
 * A profile pill (#6067): a 48px picture, the name and a projected detail line, such as a badge's issuer or a project's
 * role and years. With `href` it is a link that opens in a new tab; with `hoverCard` it opens that card on hover and focus.
 */
@Component({
  selector: 'lfx-profile-pill',
  imports: [NgTemplateOutlet, UiHoverCardDirective],
  templateUrl: './profile-pill.component.html',
  host: { class: 'flex min-w-0' },
})
export class ProfilePillComponent {
  public readonly name = input.required<string>();
  public readonly imageUrl = input<string>('');
  public readonly tile = input<ProfilePillTile>('logo');
  public readonly href = input<string | null>(null);
  public readonly hoverCard = input<TemplateRef<unknown> | null>(null);
  public readonly hoverCardWidth = input<number | null>(null);
  public readonly testId = input<string>('profile-pill');

  // Exact [Npx] design values: the 8/16/8/8 padding, 16px radius and 12px gap.
  protected readonly pillClass =
    'flex w-full min-w-0 flex-row items-center gap-[12px] rounded-[16px] border border-gray-200 bg-white py-[8px] pl-[8px] pr-[16px] text-gray-900 no-underline transition-colors duration-150 hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none';

  /** Shown in place of a missing picture. */
  protected readonly initial = computed(() => this.name().trim().charAt(0).toUpperCase());
}
