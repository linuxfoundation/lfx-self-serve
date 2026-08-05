// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, HostListener, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { PublicProfileBasic } from '@lfx-one/shared/interfaces';

// Vertical scroll (px) past which the "Powered by" pill cross-fades into the person's
// identity — roughly the point where the hero name scrolls under the sticky bar.
const IDENTITY_REVEAL_OFFSET = 200;

@Component({
  selector: 'lfx-public-profile-topbar',
  imports: [AvatarComponent],
  templateUrl: './public-profile-topbar.component.html',
})
export class PublicProfileTopbarComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly basic = input<PublicProfileBasic | null>(null);

  // Toggles the cross-fade between the "Powered by" pill and the scroll-revealed identity.
  protected readonly scrolled = signal(false);

  protected readonly name = computed(() => this.basic()?.Name?.trim() || 'LFX Contributor');
  protected readonly avatarImage = computed(() => this.basic()?.LogoURL || '');

  // "{Title} at {Company}" — mirrors the hero, hiding the "Individual" no-employer placeholder.
  protected readonly headline = computed(() => {
    const title = this.basic()?.Title?.trim() || '';
    const account = this.basic()?.AccountName?.trim();
    const company = account && !account.includes('Individual') ? account : '';
    if (title && company) {
      return `${title} at ${company}`;
    }
    return title || company;
  });

  // Window scroll only binds in the browser, so the read is SSR-safe; guard anyway per
  // .claude/rules/ssr-safety.md since it touches `window`.
  @HostListener('window:scroll')
  protected onScroll(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.scrolled.set(window.scrollY > IDENTITY_REVEAL_OFFSET);
  }
}
