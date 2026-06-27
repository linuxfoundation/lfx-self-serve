// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Tailwind background-color classes for deterministic avatar colors, picked by a stable hash of a user's identity (email/username). */
export const AVATAR_COLORS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500'];

// Default v1 myprofile avatar bucket base host (object key is the lowercased `<username>.png`); the
// interim derive path uses this unless MYPROFILE_AVATAR_BASE_URL overrides it (e.g. the dev bucket).
export const MYPROFILE_AVATAR_PROD_BASE = 'https://platform-logos-myprofile-api-prod.s3.us-east-2.amazonaws.com';
