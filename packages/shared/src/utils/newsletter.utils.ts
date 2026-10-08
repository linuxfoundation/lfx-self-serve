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

/**
 * Builds the relative path to a Newsletter group's public signup page
 * (`NewsletterSignupComponent`, mounted at `/projects/:projectSlug/newsletter-signup/:groupUid`).
 * Combine with `toAbsoluteUrl` for a shareable/copyable absolute URL.
 * @param projectSlug - The project slug the Newsletter group belongs to
 * @param groupUid - The Newsletter group (committee) uid
 * @returns The relative signup path, e.g. `/projects/cncf/newsletter-signup/abc123`
 */
export function newsletterSignupPath(projectSlug: string, groupUid: string): string {
  return `/projects/${encodeURIComponent(projectSlug)}/newsletter-signup/${encodeURIComponent(groupUid)}`;
}
