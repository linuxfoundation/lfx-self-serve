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
