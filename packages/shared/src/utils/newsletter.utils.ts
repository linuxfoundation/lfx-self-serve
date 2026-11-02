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
 * Applies one share to a newsletter's displayed tally, mirroring the server rule (one share per user
 * per channel): the count goes up only the first time a channel is used, and never when the count is
 * unknown. Returns the same object when nothing changes.
 */
export function addShareToTally(tally: NewsletterShareTally, channel: SocialShareChannel): NewsletterShareTally {
  if (tally.channels.includes(channel)) return tally;
  return { ...tally, count: tally.count === null ? null : tally.count + 1, channels: [...tally.channels, channel] };
}
