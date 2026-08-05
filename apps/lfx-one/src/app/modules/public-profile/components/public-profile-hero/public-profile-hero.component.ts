// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { PublicProfileBasic, PublicProfileSocialLink } from '@lfx-one/shared/interfaces';
import { isValidUrl } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-public-profile-hero',
  imports: [AvatarComponent, MarkdownRendererComponent],
  templateUrl: './public-profile-hero.component.html',
})
export class PublicProfileHeroComponent {
  private readonly platformId = inject(PLATFORM_ID);

  public readonly basic = input<PublicProfileBasic | null>(null);
  public readonly about = input<string>('');

  protected readonly name = computed(() => this.basic()?.Name?.trim() || 'LFX Contributor');
  protected readonly title = computed(() => this.basic()?.Title?.trim() || '');
  protected readonly bio = computed(() => this.basic()?.Bio?.trim() || '');
  protected readonly avatarImage = computed(() => this.basic()?.LogoURL || '');
  protected readonly accountLogo = computed(() => this.basic()?.AccountLogoURL?.trim() || '');

  // "Individual" is an upstream placeholder for "no employer" — hide it (matches myprofile).
  protected readonly company = computed(() => {
    const account = this.basic()?.AccountName?.trim();
    return account && !account.includes('Individual') ? account : '';
  });

  protected readonly socials: Signal<PublicProfileSocialLink[]> = this.initSocials();

  // Share the current profile URL — native share sheet when available, clipboard otherwise.
  // Guarded for SSR since it touches navigator/window (see .claude/rules/ssr-safety.md).
  protected share(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const url = window.location.href;
    if (navigator.share) {
      // Rejects on user-cancel (AbortError); nothing to recover, so swallow.
      navigator.share({ title: this.name(), url }).catch(() => undefined);
      return;
    }

    // Clipboard is undefined in insecure contexts — optional-chain and ignore failures.
    navigator.clipboard?.writeText(url).catch(() => undefined);
  }

  private initSocials(): Signal<PublicProfileSocialLink[]> {
    return computed(() => {
      const basic = this.basic();
      if (!basic) {
        return [];
      }

      const links: PublicProfileSocialLink[] = [];

      const linkedIn = this.linkedInUrl(basic.LinkedInID);
      if (linkedIn) {
        links.push({ label: 'LinkedIn', url: linkedIn, icon: 'linkedin' });
      }

      const github = this.githubUsername(basic);
      if (github) {
        links.push({ label: 'GitHub', url: `https://github.com/${github}`, icon: 'github' });
      }

      const twitter = this.twitterUrl(basic.TwitterID);
      if (twitter) {
        links.push({ label: 'X', url: twitter, icon: 'x' });
      }

      return links;
    });
  }

  private linkedInUrl(value: string | undefined): string | null {
    const vanity = value?.trim();
    if (!vanity) {
      return null;
    }
    return isValidUrl(vanity) ? vanity : `https://www.linkedin.com/in/${vanity}`;
  }

  private githubUsername(basic: PublicProfileBasic): string | null {
    const fromIdentity = basic.Identities?.find((identity) => identity.Username?.trim())?.Username?.trim();
    return fromIdentity || basic.GithubID?.trim() || null;
  }

  private twitterUrl(value: string | undefined): string | null {
    const handle = value?.trim().replace(/^@/, '');
    if (!handle) {
      return null;
    }
    return isValidUrl(handle) ? handle : `https://twitter.com/${handle}`;
  }
}
