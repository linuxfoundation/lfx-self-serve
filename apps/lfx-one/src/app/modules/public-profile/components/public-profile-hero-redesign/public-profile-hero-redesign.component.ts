// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { PUBLIC_PROFILE_HERO_COPY } from '@lfx-one/shared/constants';
import { UiButtonComponent } from '@shared/uikit/button/button.component';

import { PublicProfileHeroComponent } from '../public-profile-hero/public-profile-hero.component';

/**
 * The public profile hero under the profile redesign (#6089): no card chrome, a cover the avatar overlaps, the name with
 * GitHub and LinkedIn icon links, "{Title} at {Company}" and the bio. It reads the profile as today's hero does; the X link
 * and the Share button go.
 */
@Component({
  selector: 'lfx-public-profile-hero-redesign',
  imports: [MarkdownRendererComponent, UiButtonComponent],
  templateUrl: './public-profile-hero-redesign.component.html',
})
export class PublicProfileHeroRedesignComponent extends PublicProfileHeroComponent {
  protected readonly copy = PUBLIC_PROFILE_HERO_COPY;

  /** A picture that failed to load with nothing left to fall back to, so the person icon shows. */
  private readonly failedImage = signal<string | null>(null);

  protected readonly photo = computed(() => {
    const image = this.avatarImage();
    return image && image !== this.failedImage() ? image : '';
  });
  protected readonly github = computed(() => {
    const basic = this.basic();
    const handle = basic ? this.githubUsername(basic) : null;
    return handle ? { handle, url: `https://github.com/${encodeURIComponent(handle)}` } : null;
  });
  protected readonly linkedIn = computed(() => {
    const url = this.linkedInUrl(this.basic()?.LinkedInID);
    return url ? { handle: this.linkedInHandle(url), url } : null;
  });

  /** The uploaded photo falls back to the profile's logo; once that fails too, the person icon shows. */
  protected onPhotoError(): void {
    const image = this.avatarImage();
    const uploaded = this.basic()?.avatarUrl?.trim();
    if (uploaded && image === uploaded) {
      this.handleAvatarError();
      return;
    }
    this.failedImage.set(image);
  }

  // The vanity name from a LinkedIn profile URL, for the link's label; the URL itself when it has no /in/ path.
  private linkedInHandle(url: string): string {
    const match = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
    return match ? decodeURIComponent(match[1]) : url;
  }
}
