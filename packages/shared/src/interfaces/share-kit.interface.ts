// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHARE_KIT_PLATFORMS, SHARE_KIT_TABS } from '../constants/share-kit.constants';

/** A social platform the share kit writes posts for. */
export type ShareKitPlatform = (typeof SHARE_KIT_PLATFORMS)[number];

/** A section of the public share kit page. */
export type ShareKitTab = (typeof SHARE_KIT_TABS)[number];

/** What a copy button copied, as reported to analytics. */
export type ShareKitCopyKind = ShareKitPlatform | 'newsletter' | 'cfp_invite';

/** Registration call to action. */
export interface ShareKitRegistration {
  /** Registration page URL (https). Tracking parameters are added by the page. */
  url: string;
  /** Price shown on the register button, e.g. "$399". */
  priceLabel: string;
  /** Last day of early-bird pricing (YYYY-MM-DD), when there is one. */
  earlyBirdUntil?: string;
}

/** One ready-to-copy post, written once per platform. */
export interface ShareKitPost {
  /** Stable id, reported to analytics and in `utm_content` (lowercase, digits and hyphens). */
  id: string;
  /** Heading shown above the post, e.g. "Invite your network". */
  title: string;
  /** Post text for each platform, without the link — the page appends the tracked link. */
  text: Record<ShareKitPlatform, string>;
}

/** Newsletter and community blurb. */
export interface ShareKitNewsletterBlurb {
  /** Blurb text, without the link. */
  text: string;
  /** Link appended after "Event details:" (https). */
  url: string;
}

/** A downloadable promotional graphic. */
export interface ShareKitGraphic {
  /** Short name shown above the image and reported to analytics. */
  label: string;
  /** Image URL: https, or a path under `/share-kits/` served from the app's public folder. */
  url: string;
  /** Alt text describing the image. */
  alt: string;
  width: number;
  height: number;
}

/** Optional link to a guide that helps people write a proposal. */
export interface ShareKitCfpGuide {
  title: string;
  description: string;
  url: string;
}

/** Call for proposals section. */
export interface ShareKitCfp {
  /** Official CFP page (https). */
  url: string;
  /** Closing date (YYYY-MM-DD). */
  closesOn: string;
  heading: string;
  body: string;
  /** Invitation text to copy, without the link — the page appends the tracked CFP link. */
  invitation: string;
  guide?: ShareKitCfpGuide;
}

/** Image used for link previews (Open Graph / Twitter). */
export interface ShareKitOgImage {
  url: string;
  alt: string;
}

/**
 * Share kit content, one file per event at `apps/lfx-one/content/events/<eventSlug>/share-kit.json`.
 * Every field is plain text or a URL: the page renders text, never HTML.
 */
export interface ShareKitContent {
  eventSlug: string;
  foundationSlug: string;
  foundationName: string;
  title: string;
  tagline: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  venue: string;
  city: string;
  /** Public event page (https). */
  eventUrl: string;
  registration: ShareKitRegistration;
  posts: ShareKitPost[];
  newsletterBlurb: ShareKitNewsletterBlurb;
  graphics: ShareKitGraphic[];
  cfp?: ShareKitCfp;
  ogImage?: ShareKitOgImage;
}

/** A post as the share kit page shows it for the selected platform: text with its tracked link, and its length. */
export interface ShareKitPostView {
  id: string;
  title: string;
  /** Post text plus the tracked link, exactly as the copy button copies it. */
  text: string;
  /** Length as the platform counts it. */
  length: number;
  limit: number;
}

/** Page state for the public share kit, serialized through TransferState after SSR. */
export interface ShareKitPageState {
  loading: boolean;
  error: boolean;
  notFound: boolean;
  shareKit: ShareKitContent | null;
}

/** Result of validating one content file: the parsed content, or readable problems for the PR author. */
export interface ShareKitValidationResult {
  ok: boolean;
  content?: ShareKitContent;
  problems: string[];
}

/** Share kit content the server loaded at startup, keyed by event slug. */
export interface ShareKitLoadResult {
  kits: Map<string, ShareKitContent>;
  /** Slugs whose content file exists but failed validation (served as 500, never as stale content). */
  invalid: Set<string>;
}

/** Tracking parameters added to every link the share kit hands out. */
export interface ShareKitLinkTracking {
  /** `utm_medium`: where the link is posted (a platform, `newsletter`, or `page` for buttons on the kit itself). */
  medium: ShareKitPlatform | 'newsletter' | 'page';
  /** `utm_campaign`: the event slug. */
  campaign: string;
  /** `utm_content`: which post or button. */
  content: string;
}
