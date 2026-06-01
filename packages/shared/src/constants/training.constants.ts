// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgCertificationsResponse, OrgTrainingTabId } from '../interfaces/training.interface';

// ─── Org Training page constants ───────────────────────────────────────────

export const ORG_TRAINING_TABS: readonly { id: OrgTrainingTabId; label: string; icon: string }[] = [
  { id: 'certifications', label: 'Certifications', icon: 'fa-light fa-award' },
  { id: 'trainings', label: 'Trainings', icon: 'fa-light fa-book-open' },
] as const;

export const DEFAULT_ORG_TRAINING_TAB_ID: OrgTrainingTabId = 'certifications';

export const VALID_ORG_TRAINING_TAB_IDS: ReadonlySet<OrgTrainingTabId> = new Set(ORG_TRAINING_TABS.map((tab) => tab.id));

export const ORG_TRAINING_LEVEL_OPTIONS: readonly { label: string; value: string }[] = [
  { label: 'Beginner', value: 'BEGINNER' },
  { label: 'Intermediate', value: 'INTERMEDIATE' },
  { label: 'Advanced', value: 'ADVANCED' },
] as const;

export const VALID_ORG_TRAINING_LEVEL_VALUES: ReadonlySet<string> = new Set(ORG_TRAINING_LEVEL_OPTIONS.map((option) => option.value));

// ─── Org Certifications tab (LFXV2-1896) ─────────────────────────────────────

export const DEFAULT_ORG_CERTIFICATIONS_PAGE_SIZE = 10;
export const MAX_ORG_CERTIFICATIONS_PAGE_SIZE = 100;

export const DEFAULT_ORG_CERTIFICATIONS_SORT_FIELD = 'CERTIFIED_COUNT';
export const DEFAULT_ORG_CERTIFICATIONS_SORT_ORDER: 'ASC' | 'DESC' = 'DESC';

/** Snowflake column names that the org certifications table may be sorted by. */
export const VALID_ORG_CERTIFICATION_SORT_FIELDS: ReadonlySet<string> = new Set([
  'COURSE_NAME',
  'FOUNDATION_NAME',
  'LEVEL',
  'CERTIFIED_COUNT',
  'IN_PROGRESS_COUNT',
]);

/** Empty/error fallback for the org certifications list. */
export const EMPTY_ORG_CERTIFICATIONS_RESPONSE: OrgCertificationsResponse = {
  data: [],
  total: 0,
  pageSize: DEFAULT_ORG_CERTIFICATIONS_PAGE_SIZE,
  offset: 0,
};

/** Sort fields whose first click should default to descending (count columns); all others default to ascending. */
export const DESCENDING_DEFAULT_ORG_CERTIFICATION_SORT_FIELDS: ReadonlySet<string> = new Set(['CERTIFIED_COUNT', 'IN_PROGRESS_COUNT']);

// ─── Me-lens training constants ────────────────────────────────────────────

export const TRAINING_PRODUCT_TYPE = 'Training' as const;
export const CERTIFICATION_PRODUCT_TYPE = 'Certification' as const;
export type ProductType = typeof TRAINING_PRODUCT_TYPE | typeof CERTIFICATION_PRODUCT_TYPE;

export const CONTINUE_LEARNING_URL = 'https://trainingportal.linuxfoundation.org/learn/dashboard';
export const COURSE_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/learn/course/';
export const ENROLL_AGAIN_URL = 'https://trainingportal.linuxfoundation.org/courses';
export const ENROLL_AGAIN_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/courses/';
