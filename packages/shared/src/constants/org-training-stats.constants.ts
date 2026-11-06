// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgTrainingStatDefinition, OrgTrainingStatKey, OrgTrainingStatTileLayout } from '../interfaces/org-training-view.interface';

// Company Lens learner and enrollment numbers (lfx-self-serve#4290). Training & Certification, People › Trainees and the
// Overview tile all read their label, unit, window and tooltip definition from here, so one number carries one label
// everywhere. Definitions: lfx-self-serve#4286.

/** Caption and tooltip suffix of the roster stat for a company with no LF Education training program (no roster row). */
export const ORG_TRAINING_NO_ROSTER_NOTE = 'No LF Education training program on record for this company';

/** Caption and tooltip suffix of the outside-learners stat while a filter leaves it uncounted (a null count). */
export const ORG_TRAINING_OUTSIDE_NOT_COUNTED_NOTE = 'Not counted while a foundation, project, course, level or format is selected';

/** The rule behind "in progress", stated on its tiles and tooltips: no hidden snapshot. */
export const ORG_TRAINING_IN_PROGRESS_RULE = 'Enrolled in the selected range, no certificate in the range';

const PAIR_SCOPE =
  "for people on this company's people list, in the selected range and matching the filters. A course retaken counts once; learners not on the people list are not counted.";

export const ORG_TRAINING_STAT_DEFINITIONS: Readonly<Record<OrgTrainingStatKey, OrgTrainingStatDefinition>> = {
  rosterMembers: {
    label: 'Training-program roster members',
    unit: 'people',
    window: 'live, not filtered',
    definition:
      "People LF Education's training program lists for this company, including people who never enrolled in a course. Today's count: it does not follow the time range or the filters. Counted from the company's own training program, not merged with related companies.",
  },
  peopleWithTrainingActivity: {
    label: 'People with training activity',
    unit: 'people',
    definition:
      "Distinct people on this company's people list with at least one training or certification enrollment, or a certificate, dated in the selected range and matching the filters. Learners not on the people list are not counted here. Not a subset of the roster members.",
  },
  learnersOutsidePeopleList: {
    label: 'Learners not on the people list',
    unit: 'people',
    definition:
      'Distinct people with a training or certification enrollment or certificate dated in the selected range who are linked to this company but not on its people list. Shown as — and not counted while a foundation, project, course, level or format is selected, like their list. Not part of the people-list numbers.',
  },
  coursesTaken: {
    label: 'Courses taken',
    unit: 'person-course pairs',
    definition: `Distinct person-and-course pairs with an enrollment or a certificate dated in the selected range, ${PAIR_SCOPE} Courses taken = certifications + trainings completed + courses in progress.`,
  },
  certifications: {
    label: 'Certifications',
    unit: 'person-course pairs',
    definition: `Courses taken of certification products that ended in a certificate dated in the selected range, ${PAIR_SCOPE}`,
  },
  certifiedPeople: {
    label: 'Certified people',
    unit: 'people',
    definition: "Distinct people on this company's people list holding a certification certificate dated in the selected range, matching the filters.",
  },
  trainingsCompleted: {
    label: 'Trainings completed',
    unit: 'person-course pairs',
    definition: `Courses taken of training products that ended in a certificate dated in the selected range, ${PAIR_SCOPE}`,
  },
  completionRate: {
    label: 'Completion rate',
    unit: '% of courses taken',
    definition: `Certifications plus trainings completed, divided by courses taken, ${PAIR_SCOPE}`,
  },
  coursesInProgress: {
    label: 'Courses in progress',
    unit: 'person-course pairs',
    caption: ORG_TRAINING_IN_PROGRESS_RULE,
    definition: `${ORG_TRAINING_IN_PROGRESS_RULE}, ${PAIR_SCOPE} Not a snapshot of today: an enrollment from before the range, or one since abandoned, is judged by the range alone.`,
  },
  peopleInTraining: {
    label: 'People in training',
    unit: 'people',
    caption: ORG_TRAINING_IN_PROGRESS_RULE,
    definition: `Distinct people with at least one course in progress: ${ORG_TRAINING_IN_PROGRESS_RULE.toLowerCase()}, on this company's people list and matching the filters. Not a snapshot of today.`,
  },
};

/** Stat strip order. */
export const ORG_TRAINING_STAT_TILES: readonly OrgTrainingStatTileLayout[] = [
  { key: 'rosterMembers', icon: 'fa-light fa-address-book', iconClass: 'bg-slate-100 text-slate-600', testId: 'org-training-stat-roster-members' },
  {
    key: 'peopleWithTrainingActivity',
    icon: 'fa-light fa-user-graduate',
    iconClass: 'bg-sky-100 text-sky-600',
    testId: 'org-training-stat-people-with-training-activity',
  },
  {
    key: 'learnersOutsidePeopleList',
    icon: 'fa-light fa-user-slash',
    iconClass: 'bg-orange-100 text-orange-600',
    testId: 'org-training-stat-learners-outside-people-list',
  },
  { key: 'coursesTaken', icon: 'fa-light fa-book', iconClass: 'bg-indigo-100 text-indigo-600', testId: 'org-training-stat-courses-taken' },
  { key: 'certifications', icon: 'fa-light fa-award', iconClass: 'bg-amber-100 text-amber-600', testId: 'org-training-stat-certifications' },
  { key: 'certifiedPeople', icon: 'fa-light fa-user-check', iconClass: 'bg-violet-100 text-violet-600', testId: 'org-training-stat-certified-people' },
  { key: 'trainingsCompleted', icon: 'fa-light fa-circle-check', iconClass: 'bg-teal-100 text-teal-600', testId: 'org-training-stat-trainings-completed' },
  { key: 'completionRate', icon: 'fa-light fa-percent', iconClass: 'bg-rose-100 text-rose-600', testId: 'org-training-stat-completion-rate' },
  { key: 'coursesInProgress', icon: 'fa-light fa-book-open', iconClass: 'bg-emerald-100 text-emerald-600', testId: 'org-training-stat-courses-in-progress' },
  { key: 'peopleInTraining', icon: 'fa-light fa-users', iconClass: 'bg-blue-100 text-blue-600', testId: 'org-training-stat-people-in-training' },
];

/** The tiles People › Trainees shows before "Show more stats": the ones about the people list its table lists (lfx-self-serve#5304). */
export const ORG_TRAINING_STAT_PRIMARY_KEYS: readonly OrgTrainingStatKey[] = ['peopleWithTrainingActivity', 'coursesTaken', 'certifiedPeople'];

/** Heading of the Trainees list of learners linked to the company who are not on its people list (lfx-self-serve#4287). */
export const ORG_TRAINEES_OUTSIDE_LEARNERS_HEADING = 'Learners not on the people list';

/** Shown in place of that list while a course-level filter is picked: the list carries no course data to filter on. */
export const ORG_TRAINEES_OUTSIDE_LEARNERS_FILTERED_NOTE =
  'Learners not on the people list follow the time range and the name search only, so they are hidden while a foundation, project, course, level or format is selected.';

/** Note in the open Trainees list of learners not on the people list: one person can appear more than once, and who can recognize them (lfx-self-serve#5304). */
export const ORG_TRAINEES_OUTSIDE_LEARNERS_REVIEW_NOTE =
  'These learners have training linked to this company but are not on its people list. One person can appear more than once, for example with several training accounts under different emails. An org admin can review this list if a name looks familiar.';
