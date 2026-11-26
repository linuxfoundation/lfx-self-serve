// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, Signal, signal } from '@angular/core';
import { PROFILE_GRID_LIMIT, PUBLIC_PROFILE_BADGE_LABEL } from '@lfx-one/shared/constants';
import { PublicProfileBadge, PublicProfileBadgeItem } from '@lfx-one/shared/interfaces';
import { normalizeToUrl } from '@lfx-one/shared/utils';
import { ProfileGridComponent } from '@shared/components/profile-section/profile-grid.component';
import { ProfilePillComponent } from '@shared/components/profile-section/profile-pill.component';

/**
 * The redesigned public profile's Recognitions (#6092): the person's Credly badges as image pills in the profile grid, nine
 * before "View all (N)", each linking to Credly in a new tab. The public badge data carries only the image and the link.
 */
@Component({
  selector: 'lfx-public-profile-recognitions',
  imports: [ProfileGridComponent, ProfilePillComponent],
  templateUrl: './public-profile-recognitions.component.html',
})
export class PublicProfileRecognitionsComponent {
  public readonly badges = input<PublicProfileBadge[]>([]);

  // Simple WritableSignals
  protected readonly expanded = signal(false);

  // Complex computed/toSignal signals
  /** Badges with an image, each with a Credly link that is safe to open. */
  protected readonly items: Signal<PublicProfileBadgeItem[]> = this.initItems();
  protected readonly shown = computed(() => (this.expanded() ? this.items() : this.items().slice(0, PROFILE_GRID_LIMIT)));

  // Private initializer functions
  // A bare domain gains https:// and an unsafe scheme loses its link, as the badges block before it did (`validExternalUrl`).
  private initItems(): Signal<PublicProfileBadgeItem[]> {
    return computed(() => {
      const shown = this.badges()
        .map((badge) => ({ image: badge.Image?.trim() ?? '', url: badge.Url?.trim() ?? '' }))
        .filter((badge) => !!badge.image);
      return shown.map((badge, index) => ({
        id: `${index}`,
        label: `${PUBLIC_PROFILE_BADGE_LABEL} ${index + 1} of ${shown.length}`,
        image: badge.image,
        href: badge.url ? normalizeToUrl(badge.url) : null,
      }));
    });
  }
}
