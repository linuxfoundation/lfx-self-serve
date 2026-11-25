// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ServerFlagUserContext } from '../interfaces/server-request-context.interface';

/** Platforms a share kit writes posts for, in tab order. */
export const SHARE_KIT_PLATFORMS = ['linkedin', 'x', 'bluesky'] as const;

/** Display names for each platform tab. */
export const SHARE_KIT_PLATFORM_LABELS = {
  linkedin: 'LinkedIn',
  x: 'X',
  bluesky: 'Bluesky',
} as const;

/**
 * Character limit per platform, and how long the platform counts a pasted link.
 * X counts every link as 23 characters; Bluesky's app shortens a pasted link to about 40 before counting.
 * LinkedIn counts the full link.
 */
export const SHARE_KIT_PLATFORM_LIMITS = {
  linkedin: { limit: 3000, linkLength: null },
  x: { limit: 280, linkLength: 23 },
  bluesky: { limit: 300, linkLength: 40 },
} as const;

/** Sections of the public share kit page, in tab order. */
export const SHARE_KIT_TABS = ['share', 'graphics', 'cfp'] as const;

/** Display names for each section tab. */
export const SHARE_KIT_TAB_LABELS = {
  share: 'Share the event',
  graphics: 'Graphics',
  cfp: 'Call for proposals',
} as const;

/** `utm_source` on every link the share kit hands out. */
export const SHARE_KIT_UTM_SOURCE = 'lfx-share-kit';

/** Plausible custom events fired by the public share kit page (#6060). Props never carry personal data or member codes. */
export const SHARE_KIT_EVENTS = {
  /** A copy button was used. Props: event_slug, foundation, kind, post (post id, when a post was copied). */
  copy: 'share_kit_copy',
  /** A registration link was clicked. Props: event_slug, foundation, signed_in, placement. */
  registerClick: 'share_kit_register_click',
  /** A graphic was downloaded. Props: event_slug, foundation, label. */
  graphicDownload: 'share_kit_graphic_download',
  /** A platform tab was chosen. Props: event_slug, kind. */
  platformTab: 'share_kit_platform_tab',
  /** A call-for-proposals link was clicked. Props: event_slug, foundation, link (`cfp` or `guide`). */
  cfpClick: 'share_kit_cfp_click',
} as const;

/** Event slugs are lowercase letters, digits and single hyphens — also the content folder name. */
export const SHARE_KIT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Graphics may be served from the app's public folder under this path. */
export const SHARE_KIT_LOCAL_ASSET_PREFIX = '/share-kits/';

/**
 * The share kit read, as `publicApiRateLimiter` sees it (mount-relative). It is skipped there because the
 * page's SSR fetch arrives over loopback, so every visitor would otherwise share one per-IP budget; the
 * read is an in-memory lookup of repo-owned content.
 */
export const SHARE_KIT_PUBLIC_READ_PATTERN = /^\/events\/[a-z0-9-]+\/share-kit\/?$/;

/**
 * The one LaunchDarkly context every signed-out visitor is evaluated as for `EVENT_SHARE_KIT_FLAG`, so the flag is on
 * for all of them or none.
 */
export const SHARE_KIT_ANONYMOUS_FLAG_CONTEXT: ServerFlagUserContext = { key: 'anonymous-share-kit-visitor', anonymous: true };

/** Heading fonts an event theme may pick. Each must exist in `SHARE_KIT_HEADING_FONT_STACKS`. */
export const SHARE_KIT_HEADING_FONTS = ['inter', 'inter-tight'] as const;

/**
 * CSS font stack and, for fonts the app does not already load, the Google Fonts stylesheet the page adds
 * while a kit using it is open. Add a font here before a theme can use it.
 */
export const SHARE_KIT_HEADING_FONT_STACKS = {
  inter: { family: 'Inter, system-ui, sans-serif', stylesheet: null },
  'inter-tight': {
    family: '"Inter Tight", Inter, system-ui, sans-serif',
    stylesheet: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&display=swap',
  },
} as const;

/** WCAG AA contrast for normal text, required between each themed text colour and its background. */
export const SHARE_KIT_MIN_TEXT_CONTRAST = 4.5;

/** What the page can tell a visitor about the member discount (#6061). */
export const SHARE_KIT_MEMBER_OFFER_STATUSES = ['sign_in', 'not_member', 'eligible', 'unavailable'] as const;

/**
 * Environment variable holding member discount codes as JSON keyed by event slug, e.g. `{"<eventSlug>":"<code>"}`.
 * Set from the deployment's secret store: codes never live in this public repo.
 */
export const SHARE_KIT_MEMBER_CODES_ENV = 'SHARE_KIT_MEMBER_CODES';

/**
 * How long a signed-in visitor's membership answer is reused, in milliseconds. Membership rarely changes within
 * minutes; a company that joins or leaves is reflected after at most this long.
 */
export const SHARE_KIT_MEMBERSHIP_CACHE_MS = 5 * 60 * 1000;

/** Upper bound on remembered membership answers per process; the cache is emptied when it is reached. */
export const SHARE_KIT_MEMBERSHIP_CACHE_MAX_ENTRIES = 5000;
