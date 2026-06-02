// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingTabId } from '../interfaces/training.interface';

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

// ─── Me-lens training constants ────────────────────────────────────────────

export const TRAINING_PRODUCT_TYPE = 'Training' as const;
export const CERTIFICATION_PRODUCT_TYPE = 'Certification' as const;
export type ProductType = typeof TRAINING_PRODUCT_TYPE | typeof CERTIFICATION_PRODUCT_TYPE;

export const CONTINUE_LEARNING_URL = 'https://trainingportal.linuxfoundation.org/learn/dashboard';
export const COURSE_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/learn/course/';
export const ENROLL_AGAIN_URL = 'https://trainingportal.linuxfoundation.org/courses';
export const ENROLL_AGAIN_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/courses/';
