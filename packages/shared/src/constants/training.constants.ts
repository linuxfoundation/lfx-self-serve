// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FilterPillOption } from '../interfaces/dashboard-metric.interface';
import type { OrgTrainingGroupSortField } from '../interfaces/org-training-view.interface';
import type { OrgTrainingTabId } from '../interfaces/training.interface';

// ─── Me Training & Certifications dashboard (/me/training) ─────────────────

/** Tabs of the Me lens training dashboard; `?tab=<id>` opens one directly. */
export const TRAINING_DASHBOARD_TABS: FilterPillOption[] = [
  { id: 'certifications', label: 'Certifications' },
  { id: 'enrolled-trainings', label: 'Enrolled Trainings' },
  { id: 'rewards', label: 'Rewards' },
];

export const DEFAULT_TRAINING_DASHBOARD_TAB_ID = 'certifications';

export const VALID_TRAINING_DASHBOARD_TAB_IDS: ReadonlySet<string> = new Set(TRAINING_DASHBOARD_TABS.map((tab) => tab.id));

// ─── Org Training page constants ───────────────────────────────────────────

/** Tabs of the Training page: the product-type split (Certification vs Training) of the same group table. */
export const ORG_TRAINING_TABS: readonly { id: OrgTrainingTabId; label: string; icon: string }[] = [
  { id: 'certifications', label: 'Certifications', icon: 'fa-light fa-award' },
  { id: 'trainings', label: 'Trainings', icon: 'fa-light fa-book-open' },
] as const;

/**
 * One plain line under the group table's totals row: which products the tab counts and why its In progress total can
 * differ from the Courses in progress tile. The two tabs add up to the tile.
 */
export const ORG_TRAINING_GROUPS_SCOPE_NOTES: Readonly<Record<OrgTrainingTabId, string>> = {
  certifications:
    'This tab counts Certification products only, so its In progress total can differ from the Courses in progress tile; the Trainings tab holds the rest, and the two tabs add up to the tile.',
  trainings:
    'This tab counts all non-Certification products, so its In progress total can differ from the Courses in progress tile; the Certifications tab holds the rest, and the two tabs add up to the tile.',
};

export const DEFAULT_ORG_TRAINING_TAB_ID: OrgTrainingTabId = 'certifications';

export const VALID_ORG_TRAINING_TAB_IDS: ReadonlySet<OrgTrainingTabId> = new Set(ORG_TRAINING_TABS.map((tab) => tab.id));

// ─── Group-by table and its drawer ─────────────────────────────────────────

export const DEFAULT_ORG_TRAINING_GROUPS_PAGE_SIZE = 10;
export const MAX_ORG_TRAINING_GROUPS_PAGE_SIZE = 100;

/** Hard cap on names listed by the group drawer — bounds response size for large orgs while the drawer keeps its single-fetch, client-side-search UX. */
export const MAX_ORG_TRAINING_GROUP_EMPLOYEES = 500;

export const DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELD: OrgTrainingGroupSortField = 'completed';
export const DEFAULT_ORG_TRAINING_GROUPS_SORT_ORDER: 'ASC' | 'DESC' = 'DESC';

export const VALID_ORG_TRAINING_GROUPS_SORT_FIELDS: ReadonlySet<string> = new Set<OrgTrainingGroupSortField>([
  'label',
  'people',
  'coursesTaken',
  'completed',
  'inProgress',
]);

/** Sort fields whose first click defaults to descending (the count columns); `label` defaults to ascending. */
export const DESCENDING_DEFAULT_ORG_TRAINING_GROUPS_SORT_FIELDS: ReadonlySet<string> = new Set<OrgTrainingGroupSortField>([
  'people',
  'coursesTaken',
  'completed',
  'inProgress',
]);

// ─── Me-lens training constants ────────────────────────────────────────────

export const TRAINING_PRODUCT_TYPE = 'Training' as const;
export const CERTIFICATION_PRODUCT_TYPE = 'Certification' as const;

export const CONTINUE_LEARNING_URL = 'https://trainingportal.linuxfoundation.org/learn/dashboard';
export const COURSE_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/learn/course/';
export const ENROLL_AGAIN_URL = 'https://trainingportal.linuxfoundation.org/courses';
export const ENROLL_AGAIN_URL_PREFIX = 'https://trainingportal.linuxfoundation.org/courses/';

// ─── Enrollment window (lfx-self-serve#4288) ───────────────────────────────

/**
 * Length of the enrollment window the person detail and the All Employees expanded row apply to in-progress
 * training enrollments. Training & Certification and People › Trainees use the range selector instead. Certificates are never
 * windowed. The SQL predicate and the copy below both derive from this value so a label cannot drift from the query.
 */
export const ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS = 12;

const ORG_TRAINING_ENROLLMENT_WINDOW_LABEL = `last ${ORG_TRAINING_ENROLLMENT_WINDOW_MONTHS} months`;

/** Note on the person detail Training tab. Expired certificates are dropped upstream: lf-dbt `platinum_lfx_one_org_people_training` skips certificates the source flags `is_deleted`, which is how the source marks expiry. */
export const PERSON_DETAIL_TRAINING_WINDOW_NOTE = `Current certificates, issued at any time; certificates the training system marks expired are not listed. Enrollments from the ${ORG_TRAINING_ENROLLMENT_WINDOW_LABEL} only.`;

/** Note on the All Employees expanded row, whose course count follows the page's time range while this list does not. */
export const ORG_ALL_EMPLOYEES_TRAINING_WINDOW_NOTE = `${PERSON_DETAIL_TRAINING_WINDOW_NOTE} The course count on the row follows the page's time range.`;

/** Empty state of the windowed person detail and All Employees training lists. */
export const PERSON_DETAIL_TRAINING_EMPTY_NOTE = `No current certificates, and no enrollments in the ${ORG_TRAINING_ENROLLMENT_WINDOW_LABEL}.`;
