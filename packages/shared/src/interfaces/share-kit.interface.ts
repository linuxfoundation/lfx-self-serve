// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SHARE_KIT_HEADING_FONTS, SHARE_KIT_MEMBER_OFFER_STATUSES, SHARE_KIT_PLATFORMS, SHARE_KIT_TABS } from '../constants/share-kit.constants';

/** A social platform the share kit writes posts for. */
export type ShareKitPlatform = (typeof SHARE_KIT_PLATFORMS)[number];

/** A section of the public share kit page. */
export type ShareKitTab = (typeof SHARE_KIT_TABS)[number];

/** What a copy button copied, as reported to analytics. */
export type ShareKitCopyKind = ShareKitPlatform | 'newsletter' | 'cfp_invite' | 'member_code';

/** What the page can tell a visitor about the member discount. */
export type ShareKitMemberOfferStatus = (typeof SHARE_KIT_MEMBER_OFFER_STATUSES)[number];

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

/** A graphic as the page renders it: `local` graphics are same-origin, so the browser can download them. */
export interface ShareKitGraphicView extends ShareKitGraphic {
  local: boolean;
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

/**
 * Public description of a member-only discount. The code itself is not here: it comes from the
 * `SHARE_KIT_MEMBER_CODES` secret and is only ever sent to signed-in employees of a member company.
 */
export interface ShareKitMemberBenefit {
  /** Membership whose companies qualify: the project slug of its project memberships, e.g. `tlf`. */
  membershipSlug: string;
  /** Membership name shown to visitors, e.g. "AAIF". */
  membershipName: string;
  /** What members get, e.g. "20% off registration". */
  discountLabel: string;
  /** Where a non-member company can learn about joining (https). */
  joinUrl: string;
}

/** The member discount as the endpoint returns it for this visitor. */
export interface ShareKitMemberOffer {
  status: ShareKitMemberOfferStatus;
  /** Present only when `status` is `eligible`. */
  code?: string;
  /** The visitor's member company, when `status` is `eligible`. */
  companyName?: string;
}

/** Image used for link previews (Open Graph / Twitter). */
export interface ShareKitOgImage {
  url: string;
  alt: string;
}

export type ShareKitHeadingFont = (typeof SHARE_KIT_HEADING_FONTS)[number];

/** An event theme's colours, as `#RRGGBB`. Text colours must reach WCAG AA against their backgrounds. */
export interface ShareKitThemeColors {
  /** Hero background. */
  hero: string;
  /** Text on the hero. */
  heroText: string;
  /** Quiet hero shapes. Decorative only, never text. */
  soft: string;
  /** Decorative accent: the headline's full stop and hero shapes. Never used for text. */
  accent: string;
  /** Register button background, and its text colour. */
  button: string;
  buttonText: string;
  /** Copy buttons, links and selected tabs; white text sits on it. */
  primary: string;
  /** Page background behind the cards. */
  page: string;
}

/** The event's logo for the hero, drawn for the hero background (for example white on a dark hero). */
export interface ShareKitThemeLogo {
  /** https, or a path under `/share-kits/<eventSlug>/`. */
  url: string;
  /** Usually the event name. */
  alt: string;
  width: number;
  height: number;
}

/** Optional event branding. Without it the page uses the standard LFX look. */
export interface ShareKitTheme {
  colors: ShareKitThemeColors;
  logo?: ShareKitThemeLogo;
  /** Hero headline, shown in place of the event title (the logo carries the name). */
  headline?: string;
  headingFont: ShareKitHeadingFont;
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
  theme?: ShareKitTheme;
  memberBenefit?: ShareKitMemberBenefit;
}

/** A remembered membership answer for one user and membership: the member company's name, or null when not a member. */
export interface ShareKitMembershipCacheEntry {
  expiresAt: number;
  companyName: string | null;
}

/** The share kit endpoint's response: the content, plus the member offer for this visitor when the kit has one. */
export interface ShareKitResponse extends ShareKitContent {
  memberOffer?: ShareKitMemberOffer;
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
  /** The event slug this state was requested for (from the route), so it is known even when the kit failed to load. */
  eventSlug: string | null;
  loading: boolean;
  error: boolean;
  notFound: boolean;
  shareKit: ShareKitResponse | null;
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
  /** `utm_medium`: where the link is posted (a platform, `newsletter`, `cfp` for the speaker invitation, or `page` for buttons on the kit itself). */
  medium: ShareKitPlatform | 'newsletter' | 'cfp' | 'page';
  /** `utm_campaign`: the event slug. */
  campaign: string;
  /** `utm_content`: which post or button. */
  content: string;
}
