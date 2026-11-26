// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { booleanAttribute, Component, computed, input, TemplateRef } from '@angular/core';
import { ProfilePillTile } from '@lfx-one/shared/interfaces';
import { UiHoverCardDirective } from '@shared/uikit/hover-card/hover-card.directive';

/**
 * A profile pill (#6067): a 48px picture, the name and a projected detail line, such as a badge's issuer or a project's
 * role and years. With `href` it is a link that opens in a new tab; with `hoverCard` it opens that card on hover and focus.
 */
@Component({
  selector: 'lfx-profile-pill',
  imports: [NgClass, NgTemplateOutlet, UiHoverCardDirective],
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
  /** Shows the picture alone, for a badge known only by its image; the name still names the pill to assistive tech (#6092). */
  public readonly imageOnly = input<boolean, unknown>(false, { transform: booleanAttribute });

  // Exact [Npx] design values: the 8/16/8/8 padding, 16px radius and 12px gap. Token colours follow a surrounding theme (#6091).
  protected readonly pillClass =
    'flex w-full min-w-0 flex-row items-center gap-[12px] rounded-[16px] border border-ui-neutral-200 bg-ui-background-100 py-[8px] pl-[8px] pr-[16px] text-ui-neutral-900 no-underline transition-colors duration-150 hover:bg-ui-neutral-50 focus-visible:bg-ui-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 motion-reduce:transition-none';

  /** A logo sits in a framed tile, which turns white in a dark theme so the logo reads (#6091); a badge image stands on its own. */
  protected readonly tileClass = computed(() =>
    this.tile() === 'logo' ? 'rounded-[12px] shadow-[inset_0_0_0_1px_theme(colors.gray.200)] [[data-theme=dark]_&]:bg-white' : ''
  );
  /** An image alone sits centred, with even padding. */
  protected readonly layoutClass = computed(() => (this.imageOnly() ? 'justify-center !pr-[8px]' : ''));
  /** A pill that opens a card is a named group; an image alone is named as an image. */
  protected readonly tileRole = computed(() => {
    if (this.hoverCard()) return 'group';
    return this.imageOnly() ? 'img' : null;
  });

  /** Shown in place of a missing picture. */
  protected readonly initial = computed(() => this.name().trim().charAt(0).toUpperCase());
}
