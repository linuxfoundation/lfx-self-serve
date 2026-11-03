// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SocialShareChannel, SocialSharePlatform } from '../interfaces/social-share.interface';

/**
 * Share destinations in display order. Fills are the platforms' own brand colors (not `lfxColors`),
 * applied as inline styles because Tailwind does not scan this package.
 */
export const SOCIAL_SHARE_PLATFORMS: readonly SocialSharePlatform[] = [
  { key: 'x', label: 'Share on X', icon: 'fa-brands fa-x-twitter', background: '#000000', foreground: '#ffffff' },
  { key: 'linkedin', label: 'Share on LinkedIn', icon: 'fa-brands fa-linkedin-in', background: '#0a66c2', foreground: '#ffffff' },
  { key: 'reddit', label: 'Share on Reddit', icon: 'fa-brands fa-reddit-alien', background: '#ff4500', foreground: '#ffffff' },
  { key: 'email', label: 'Share by email', icon: 'fa-light fa-envelope', background: null, foreground: null },
];

/** Every share action the dialog reports, in display order — the values newsletter-service accepts for a share. */
export const SHARE_CHANNELS: readonly SocialShareChannel[] = [...SOCIAL_SHARE_PLATFORMS.map((platform) => platform.key), 'copy_link'];

/** Short display names for each share channel, used by share breakdowns. */
export const SHARE_CHANNEL_LABELS: Readonly<Record<SocialShareChannel, string>> = {
  x: 'X',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  email: 'Email',
  copy_link: 'Copy link',
};
