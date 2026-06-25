// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { AVATAR_COLORS, MYPROFILE_AVATAR_PROD_BASE } from '../constants/avatar.constants';

// Interim derive path: the zero-call myprofile URL (`<base>/<username>.png`); null when no username (an `<img onerror>` keeps it fail-soft).
function buildMyprofileAvatarUrl(username: string | null | undefined, baseUrl: string = MYPROFILE_AVATAR_PROD_BASE): string | null {
  const handle = (username ?? '').trim().toLowerCase();
  if (!handle) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(handle)}.png`;
}

// Resolve a committee seat's avatar URL: inline `avatar` wins, else derive from `username` (interim path). Null → initials.
export function resolveSeatAvatarUrl(seat: { avatar?: string | null; username?: string | null }, baseUrl?: string): string | null {
  const inline = seat.avatar?.trim();
  if (inline) {
    return inline;
  }
  return buildMyprofileAvatarUrl(seat.username ?? null, baseUrl);
}

// Deterministic palette class from a stable hash of the lowercased identity (same person → same color everywhere).
export function avatarColorClass(identity: string | null | undefined): string {
  const key = (identity ?? '').trim().toLowerCase();
  if (!key) {
    return AVATAR_COLORS[0];
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Two-letter initials from first+last name, else first two alphanumerics of `fallback`; '' when nothing usable.
export function avatarInitials(firstName: string | null | undefined, lastName: string | null | undefined, fallback?: string | null): string {
  const first = (firstName ?? '').trim();
  const last = (lastName ?? '').trim();
  const fromName = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  if (fromName) {
    return fromName;
  }
  return (fallback ?? '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
}
