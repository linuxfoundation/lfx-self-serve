// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
