// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

const LEGACY_USERNAME_MAX_LENGTH = 60;

export function stripAuthPrefixOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value.startsWith('auth0|') ? value.slice(6) : value;
  if (!stripped.trim()) return null;
  return stripped.length > LEGACY_USERNAME_MAX_LENGTH ? null : stripped;
}

export function stripAuthPrefix(value: string | null | undefined): string {
  return stripAuthPrefixOrNull(value) ?? 'N/A';
}
