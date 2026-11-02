// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Destinations offered by the share dialog. */
export type SocialSharePlatformKey = 'x' | 'linkedin' | 'reddit' | 'email';

/** Display metadata for one share destination. */
export interface SocialSharePlatform {
  key: SocialSharePlatformKey;
  /** Accessible name, e.g. "Share on LinkedIn". */
  label: string;
  /** Font Awesome classes for the round button's glyph. */
  icon: string;
  /** Third-party brand fill; `null` renders the neutral outlined button. */
  background: string | null;
  /** Glyph color on the brand fill. */
  foreground: string | null;
}

/** A share destination resolved for a specific URL and title. */
export interface SocialShareLink extends SocialSharePlatform {
  href: string;
}

/** Data passed to `ShareDialogComponent` through `DynamicDialogConfig.data`. */
export interface ShareDialogData {
  /** Absolute URL being shared. */
  url: string;
  /** Title prefilled into posts and the email subject. */
  title: string;
  /** Small line above the "Share" heading; defaults to `title`. */
  eyebrow?: string;
  /** Toast detail after Copy link; defaults to a generic message. */
  copiedMessage?: string;
}
