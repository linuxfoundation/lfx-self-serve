// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { PublicProfileBasic, PublicProfileSocialLink } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-public-profile-hero',
  imports: [AvatarComponent, ButtonComponent, ExpandableTextComponent],
  templateUrl: './public-profile-hero.component.html',
})
export class PublicProfileHeroComponent {
  public readonly basic = input<PublicProfileBasic | null>(null);
  public readonly authenticated = input<boolean>(false);

  public readonly signIn = output<void>();

  protected readonly name = computed(() => this.basic()?.Name?.trim() || 'LFX Contributor');
  protected readonly title = computed(() => this.basic()?.Title?.trim() || '');
  protected readonly bio = computed(() => this.basic()?.Bio?.trim() || '');
  protected readonly avatarImage = computed(() => this.basic()?.LogoURL || '');

  // "Individual" is an upstream placeholder for "no employer" — hide it (matches myprofile).
  protected readonly company = computed(() => {
    const account = this.basic()?.AccountName?.trim();
    return account && !account.includes('Individual') ? account : '';
  });

  // "{Title} at {Company}" when both exist; otherwise whichever is present.
  protected readonly headline = computed(() => {
    const title = this.title();
    const company = this.company();
    if (title && company) {
      return `${title} at ${company}`;
    }
    return title || company;
  });

  protected readonly socials: Signal<PublicProfileSocialLink[]> = this.initSocials();

  private initSocials(): Signal<PublicProfileSocialLink[]> {
    return computed(() => {
      const basic = this.basic();
      if (!basic) {
        return [];
      }

      const links: PublicProfileSocialLink[] = [];

      const linkedIn = this.linkedInUrl(basic.LinkedInID);
      if (linkedIn) {
        links.push({ label: 'LinkedIn', url: linkedIn, icon: 'fa-brands fa-linkedin-in' });
      }

      const github = this.githubUsername(basic);
      if (github) {
        links.push({ label: 'GitHub', url: `https://github.com/${github}`, icon: 'fa-brands fa-github' });
      }

      const twitter = this.twitterUrl(basic.TwitterID);
      if (twitter) {
        links.push({ label: 'X', url: twitter, icon: 'fa-brands fa-x-twitter' });
      }

      return links;
    });
  }

  private linkedInUrl(value: string | undefined): string | null {
    const vanity = value?.trim();
    if (!vanity) {
      return null;
    }
    return vanity.includes('http') ? vanity : `https://www.linkedin.com/in/${vanity}`;
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
    return handle.includes('http') ? handle : `https://twitter.com/${handle}`;
  }
}
