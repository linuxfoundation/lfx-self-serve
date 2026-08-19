// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, HostListener, inject, input, PLATFORM_ID, signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { PublicProfileBasic } from '@lfx-one/shared/interfaces';
import { formatAffiliation } from '@lfx-one/shared/utils';

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

  // Same two-tier fallback as the hero (LFXV2-2628): prefer the uploaded avatar, fall back to
  // LogoURL if it 404s (tracked by comparing against the exact URL that errored).
  private readonly erroredAvatarUrl = signal<string | null>(null);
  protected readonly avatarImage = computed(() => {
    const basic = this.basic();
    const uploaded = basic?.avatarUrl?.trim();
    if (uploaded && this.erroredAvatarUrl() !== uploaded) {
      return uploaded;
    }
    return basic?.LogoURL?.trim() || '';
  });

  // "{Title} at {Company}" — mirrors the hero, hiding the "Individual" no-employer placeholder.
  protected readonly headline = computed(() => formatAffiliation(this.basic()));

  // Coalesces scroll bursts into one read per animation frame; the flag drops events queued
  // before the frame runs, so change detection fires only on the threshold crossing.
  private scrollFramePending = false;

  // Window scroll only binds in the browser, so the read is SSR-safe; guard anyway per
  // .claude/rules/ssr-safety.md since it touches `window`.
  @HostListener('window:scroll')
  protected onScroll(): void {
    if (!isPlatformBrowser(this.platformId) || this.scrollFramePending) {
      return;
    }
    this.scrollFramePending = true;
    window.requestAnimationFrame(() => {
      this.scrolled.set(window.scrollY > IDENTITY_REVEAL_OFFSET);
      this.scrollFramePending = false;
    });
  }

  /** Record the uploaded-avatar URL as errored so `avatarImage` falls back to LogoURL. */
  protected handleAvatarError(): void {
    const uploaded = this.basic()?.avatarUrl?.trim();
    if (uploaded) {
      this.erroredAvatarUrl.set(uploaded);
    }
  }
}
