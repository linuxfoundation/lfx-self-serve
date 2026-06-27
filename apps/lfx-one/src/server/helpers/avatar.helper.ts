// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { resolveSeatAvatarUrl } from '@lfx-one/shared/utils';

// Single server-side read of the env base for the interim derive path (prod default in the helper).
const MYPROFILE_AVATAR_BASE = process.env['MYPROFILE_AVATAR_BASE_URL'] || undefined;

// Inline `avatar` wins; otherwise derive from `username`. Null → initials. Wraps the pure shared helper
// with the env base so every committee-seat mapper resolves avatars identically (no per-file env read).
export function resolveSeatAvatar(seat: { avatar?: string | null; username?: string | null }): string | null {
  return resolveSeatAvatarUrl(seat, MYPROFILE_AVATAR_BASE);
}
