// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTraineesStatKey, OrgTrainingStatDefinition, OrgTrainingStatKey, OrgTrainingStatTileLayout } from '../interfaces/training.interface';

// Org Lens learner and enrollment numbers (lfx-self-serve#4290). Every surface reads its label, unit, window and
// tooltip definition from here so one definition carries one label everywhere. Definitions: lfx-self-serve#4286.

/** Caption and tooltip suffix of the roster stat for an organization with no LF Education training program (no roster row). */
export const ORG_TRAINING_NO_ROSTER_NOTE = 'No LF Education training program on record for this organization';

/** Window of the in-progress numbers: today's state, not a cumulative count. */
export const ORG_TRAINING_SNAPSHOT_WINDOW = 'snapshot';

/** Heading of the stat strip's in-progress row, which sits apart from the cumulative numbers. */
export const ORG_TRAINING_SNAPSHOT_HEADING = 'In progress now: a snapshot, not a cumulative count';

/**
 * Caption of the Overview training tile's chart, which keeps this year's cumulative enrollments (ORG_TRAINING_ENROLLMENTS,
 * enrollments not yet certified, attributed by the enrollment's own account) under the people-with-training-activity headline.
 */
export const ORG_OVERVIEW_TRAINING_TREND_LABEL = 'Chart: training enrollments this calendar year, cumulative (enrollments, not people)';

export const ORG_TRAINING_STAT_DEFINITIONS: Readonly<Record<OrgTrainingStatKey, OrgTrainingStatDefinition>> = {
  rosterMembers: {
    label: 'Training-program roster members',
    unit: 'people',
    window: 'live count',
    definition:
      "People LF Education's training program lists for this organization, including people who never enrolled in a course. Counted from the organization's own training program, not merged with related organizations.",
  },
  peopleWithTrainingActivity: {
    label: 'People with training activity',
    unit: 'people',
    window: 'all time',
    definition:
      'Distinct people with at least one training or certification enrollment, or a certificate, at any time and in any status. Includes learners linked to this organization who are not on its people list. Not a subset of the roster members: many roster members never enrolled, and some learners are not roster members.',
  },
  certifiedPeople: {
    label: 'Certified people',
    unit: 'people',
    window: 'current certificates, issued at any time',
    definition:
      "Distinct people on this organization's people list holding at least one current certification certificate, issued at any time. Expired certificates are not counted.",
  },
  certificationsEarned: {
    label: 'Certifications earned',
    unit: 'certificates',
    window: 'current certificates, issued at any time',
    definition:
      "Current certification certificates held by people on this organization's people list, issued at any time; a person with two certificates counts twice. Expired certificates are not counted.",
  },
  peopleInTraining: {
    label: 'People in training',
    unit: 'people',
    window: ORG_TRAINING_SNAPSHOT_WINDOW,
    definition:
      "People on this organization's people list with at least one training course in progress today, per LF Education's active-enrollment flag. A snapshot of today, not a cumulative count.",
  },
  trainingCoursesInProgress: {
    label: 'Training courses in progress',
    unit: 'enrollments',
    window: ORG_TRAINING_SNAPSHOT_WINDOW,
    definition:
      "Training-course enrollments in progress today for people on this organization's people list; a person in two courses counts twice. A snapshot of today, not a cumulative count.",
  },
};

/** Stat strip order: the cumulative numbers first, then the in-progress snapshot in its own row. */
export const ORG_TRAINING_STAT_TILES: readonly OrgTrainingStatTileLayout[] = [
  {
    key: 'rosterMembers',
    group: 'cumulative',
    icon: 'fa-light fa-address-book',
    iconClass: 'bg-slate-100 text-slate-600',
    testId: 'org-training-stat-roster-members',
    tab: null,
  },
  {
    key: 'peopleWithTrainingActivity',
    group: 'cumulative',
    icon: 'fa-light fa-user-graduate',
    iconClass: 'bg-sky-100 text-sky-600',
    testId: 'org-training-stat-people-with-training-activity',
    tab: null,
  },
  {
    key: 'certifiedPeople',
    group: 'cumulative',
    icon: 'fa-light fa-user-check',
    iconClass: 'bg-violet-100 text-violet-600',
    testId: 'org-training-stat-certified-employees',
    tab: 'certifications',
  },
  {
    key: 'certificationsEarned',
    group: 'cumulative',
    icon: 'fa-light fa-award',
    iconClass: 'bg-amber-100 text-amber-600',
    testId: 'org-training-stat-certifications-earned',
    tab: 'certifications',
  },
  {
    key: 'peopleInTraining',
    group: 'snapshot',
    icon: 'fa-light fa-users',
    iconClass: 'bg-blue-100 text-blue-600',
    testId: 'org-training-stat-employees-in-training',
    tab: 'trainings',
  },
  {
    key: 'trainingCoursesInProgress',
    group: 'snapshot',
    icon: 'fa-light fa-book-open',
    iconClass: 'bg-emerald-100 text-emerald-600',
    testId: 'org-training-stat-training-courses-enrolled',
    tab: 'trainings',
  },
];

/** Trainees stat cards: same definitions as the strip, windowed by the page's range and narrowed by its filters. */
export const ORG_TRAINEES_STAT_DEFINITIONS: Readonly<Record<OrgTraineesStatKey, OrgTrainingStatDefinition>> = {
  trainees: {
    label: ORG_TRAINING_STAT_DEFINITIONS.peopleWithTrainingActivity.label,
    unit: 'people',
    definition:
      'Distinct people with at least one training or certification enrollment, or a certificate, dated in the selected range and matching the filters.',
  },
  coursesEnrolled: {
    label: 'Courses taken',
    unit: 'person-course pairs',
    definition:
      'Distinct person-and-course pairs with an enrollment or a certificate dated in the selected range and matching the filters; a person in two courses counts twice, a course retaken counts once.',
  },
  certifications: {
    label: 'Certifications',
    unit: 'person-course pairs',
    definition: 'Courses taken that ended in a current certificate, dated in the selected range and matching the filters.',
  },
  completionRate: {
    label: 'Completion rate',
    unit: '% of courses taken',
    definition: 'Certifications divided by courses taken, in the selected range and matching the filters.',
  },
};
