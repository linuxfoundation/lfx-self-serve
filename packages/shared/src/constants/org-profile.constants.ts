// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Spec 021 — Org Profile edit form dropdown options. Values match the LFX One V3 wireframe Industry and Technology Sector lists; "Other" is the fallback for unrecognized backend values.

export const INDUSTRY_OPTIONS: string[] = [
  'Internet Software & Services',
  'Open Source Software',
  'Automotive',
  'Computer Hardware & Software',
  'Social Media & Technology',
  'Financial Services',
  'Healthcare & Life Sciences',
  'Telecommunications',
  'Energy',
  'Other',
];

export const SECTOR_OPTIONS: string[] = [
  'Information Technology',
  'Manufacturing',
  'Financial Services',
  'Healthcare',
  'Energy',
  'Government',
  'Education',
  'Other',
];

/** Max length for the Organization Description textarea (FR-007). */
export const ORG_DESCRIPTION_MAX_LENGTH = 2000;

/** MIME types accepted for org logo uploads (LFXV2-2016/LFXV2-3288), matching member-service's allow-list (`pkg/constants/logo.go`). SVG is sanitized server-side in member-service (`pkg/svgsanitize`) before it's stored. */
export const ALLOWED_ORG_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

/** Maximum org logo upload size in bytes (2MB), matching member-service's `MaxB2BOrgLogoSizeBytes`. */
export const MAX_ORG_LOGO_SIZE_BYTES = 2 * 1024 * 1024;

/** Below this width/height (px), the logo warns as likely to look blurry when displayed. Non-blocking — upload proceeds regardless. Not checked for SVG (vector). */
export const MIN_ORG_LOGO_DIMENSION_PX = 128;

/** Above this width/height (px), member-service downscales the logo server-side, preserving aspect ratio (`MaxLogoDimensionPx` in `pkg/constants/logo.go`). Warned about client-side so the user knows it'll happen; non-blocking, and not checked for SVG (vector, never resized). */
export const MAX_ORG_LOGO_DIMENSION_PX = 1024;
