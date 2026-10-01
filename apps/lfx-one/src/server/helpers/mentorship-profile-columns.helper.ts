// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MentorshipUpstreamUserProfile } from '@lfx-one/shared/interfaces';

/** The mentorship service stores its JSON columns free-form, so each one is narrowed before use. */
export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A blank string is an unanswered field, the same as a missing one. */
export const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

export const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => asString(item) !== undefined) : []);

/** Display name for a stored resume link: the last path segment, or nothing when the URL has none. */
const resumeFileNameFromUrl = (url: string): string | undefined => {
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
};

/** The stored resume of a mentee or mentor profile, from `profile_links.resumeLink`, with its display name. */
export const mapMentorshipProfileResume = (profile: MentorshipUpstreamUserProfile): { resumeUrl?: string; resumeFileName?: string } => {
  const resumeUrl = asString(asRecord(profile.profile_links)?.['resumeLink']);
  return { resumeUrl, resumeFileName: resumeUrl ? resumeFileNameFromUrl(resumeUrl) : undefined };
};
