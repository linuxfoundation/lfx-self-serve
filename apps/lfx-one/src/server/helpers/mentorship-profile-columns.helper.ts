// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** The mentorship service stores its JSON columns free-form, so each one is narrowed before use. */
export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** A blank string is an unanswered field, the same as a missing one. */
export const asString = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

export const asStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => asString(item) !== undefined) : []);
