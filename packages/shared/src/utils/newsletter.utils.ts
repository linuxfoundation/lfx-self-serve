// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_BLOCKS_LIVE_SEND_ENABLED,
  NEWSLETTER_BLOCKS_PROJECT_SLUGS,
  NEWSLETTER_DATE_TIME_ZONE,
  NEWSLETTER_SEND_DATE_PLACEHOLDER,
} from '../constants/newsletter.constants';
import { NewsletterShareTally } from '../interfaces/newsletter.interface';
import { SocialShareChannel } from '../interfaces/social-share.interface';

/**
 * Builds the relative path to a newsletter issue's canonical permalink page
 * (`NewsletterReaderComponent`, mounted at `/newsletters/:projectSlug/:id`).
 * Combine with `toAbsoluteUrl` for a shareable/copyable absolute URL.
 * @param projectSlug - The newsletter's project slug
 * @param newsletterId - The newsletter issue id
 * @returns The relative permalink path, e.g. `/newsletters/cncf/abc123`
 */
export function newsletterIssuePath(projectSlug: string, newsletterId: string): string {
  return `/newsletters/${projectSlug}/${newsletterId}`;
}

/**
 * Applies one accepted share to a newsletter's displayed tally. Optimistic: the count goes up the first
 * time a channel is used on the page and never when the count is unknown, approximating the server rule
 * (one share per user per channel). It can over-count a repeat of a channel the user already shared
 * from an earlier page load, until the next reload. Returns the same object when nothing changes.
 */
export function addShareToTally(tally: NewsletterShareTally, channel: SocialShareChannel): NewsletterShareTally {
  if (tally.channels.includes(channel)) return tally;
  return { ...tally, count: tally.count === null ? null : tally.count + 1, channels: [...tally.channels, channel] };
}

/**
 * The share count a Share button shows: hidden (null) while unknown or zero. Shared by the reader drawer's
 * Share button and the reader page's engagement rail so both show the same issue's count the same way.
 */
export function visibleShareCount(count: number | null | undefined): number | null {
  return count && count > 0 ? count : null;
}

/**
 * Accessible name of a Share button for an already-visible count (see {@link visibleShareCount}),
 * e.g. "Share, shared 1,234 times"; just "Share" when no count is shown.
 */
export function shareButtonAriaLabel(visibleCount: number | null): string {
  if (visibleCount === null) return 'Share';
  return visibleCount === 1 ? 'Share, shared 1 time' : `Share, shared ${visibleCount.toLocaleString('en-US')} times`;
}

/**
 * The single "views" number shown for a newsletter: email opens (`total_opens`) plus unique web page views
 * (`page_view_count`), which the newsletter service stores separately. A missing half counts as 0 so one
 * known source still shows; null (hide the number) only when both are unknown. A reader who opens the
 * email and then reads online counts in both halves, by design.
 */
export function combinedViewCount(opens: number | null | undefined, pageViews: number | null | undefined): number | null {
  if (opens == null && pageViews == null) return null;
  return (opens ?? 0) + (pageViews ?? 0);
}

/**
 * Replaces the send-date token in a newsletter's stored HTML, in the same format and timezone the
 * service uses at send time. The stored body keeps the token even after the send.
 * @param html - The rendered newsletter HTML
 * @param now - The date to show: the send date when there is one, otherwise today
 * @returns The HTML with every send-date token filled in
 */
export function withNewsletterPreviewDate(html: string, now: Date = new Date()): string {
  if (!html.includes(NEWSLETTER_SEND_DATE_PLACEHOLDER)) return html;
  const date = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: NEWSLETTER_DATE_TIME_ZONE }).format(now);
  return html.replaceAll(NEWSLETTER_SEND_DATE_PLACEHOLDER, date);
}

/**
 * Whether the block composer is available for a newsletter. A draft that already has a layout is
 * always editable in it, because the basic editor would edit body_html while the layout stays
 * authoritative upstream. New authoring needs the feature flag and a pilot project, and the pilot
 * slug only counts when the active context is the newsletter's owning project.
 */
export function isNewsletterBlocksEnabled(options: { hasLayout: boolean; flagEnabled: boolean; contextIsOwner: boolean; projectSlug?: string }): boolean {
  if (options.hasLayout) return true;
  return options.flagEnabled && options.contextIsOwner && NEWSLETTER_BLOCKS_PROJECT_SLUGS.includes(options.projectSlug ?? '');
}

/**
 * Whether a real send or schedule is locked for a draft. Only a draft with a layout is affected.
 * A basic editor draft always sends as before.
 */
export function isNewsletterLiveSendLocked(hasLayout: boolean, liveSendEnabled: boolean = NEWSLETTER_BLOCKS_LIVE_SEND_ENABLED): boolean {
  return hasLayout && !liveSendEnabled;
}
