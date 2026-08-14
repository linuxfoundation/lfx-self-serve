// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

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
