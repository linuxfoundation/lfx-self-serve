// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SOCIAL_SHARE_PLATFORMS } from '../constants/social-share.constants';
import { SocialShareLink, SocialSharePlatformKey } from '../interfaces/social-share.interface';

/**
 * Builds the share-intent URL for one platform. The newsletter service renders the same URLs into
 * the email's date bar, so keep the two in step.
 * @param platform - The share destination
 * @param url - The absolute URL being shared
 * @param title - Text prefilled into the post, Reddit title, or email subject
 * @returns The intent URL (`mailto:` for email)
 */
export function buildSocialShareHref(platform: SocialSharePlatformKey, url: string, title: string): string {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);

  switch (platform) {
    case 'x':
      return `https://x.com/intent/tweet?url=${u}&text=${t}`;
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    case 'reddit':
      return `https://www.reddit.com/submit?url=${u}&title=${t}`;
    case 'email':
      return `mailto:?subject=${t}&body=${encodeURIComponent(`${title}\n\n${url}`)}`;
  }
}

/**
 * Resolves every share destination, in display order, for a URL and title.
 * @param url - The absolute URL being shared
 * @param title - Text prefilled into each destination
 * @returns One link per platform in `SOCIAL_SHARE_PLATFORMS`
 */
export function buildSocialShareLinks(url: string, title: string): SocialShareLink[] {
  return SOCIAL_SHARE_PLATFORMS.map((platform) => ({ ...platform, href: buildSocialShareHref(platform.key, url, title) }));
}
