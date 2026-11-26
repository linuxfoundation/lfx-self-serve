// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Internal Trainees query-row shapes for the Org Lens People backend service.
// They live in the shared package because AGENTS.md prohibits module-level interfaces
// inside apps/lfx-one/; they are NOT part of the wire contract consumed by the frontend.

import type { OrgPeopleAllTraineeRow, OrgTraineeFormerOnPeopleListCounts, OrgTrainingOutsideLearnerRow } from './org-people-trainees.interface';

/** One warehouse-resolved person-course pair of a people-list member in the range. */
export interface OrgPeopleTrainingPairRow {
  PERSON_KEY: string;
  COURSE_KEY: string;
  IS_CERTIFIED: boolean | null;
  PRODUCT_TYPE: string | null;
  COURSE_NAME: string | null;
  COURSE_LEVEL: string | null;
  COURSE_FORMAT: string | null;
  FOUNDATION_ID: string | null;
  FOUNDATION_NAME: string | null;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
  LAST_ACTIVITY_TS: Date | string | null;
}

/** One enrollment or certificate row of a people-list member, as read for the expanded sub-table's dates. */
export interface OrgPeopleTrainingDateRow {
  PERSON_KEY: string;
  COURSE_ID: string | null;
  COURSE_OR_CERT_ID: string;
  STATUS: string | null;
  ACTIVITY_TS: Date | string | null;
}

/** A date row keyed to the pair it belongs to. */
export interface OrgTraineeDateRow {
  PERSON_KEY: string;
  COURSE_KEY: string;
  STATUS: string | null;
  ACTIVITY_TS: Date | string | null;
}

/** The raw Trainees reads, as cached and as mapped into the response. */
export interface OrgTraineesRaw {
  traineeRows: OrgPeopleAllTraineeRow[];
  outsideLearnerRows: OrgTrainingOutsideLearnerRow[];
  pairRows: OrgPeopleTrainingPairRow[];
  dateRows: OrgTraineeDateRow[];
  formerOnPeopleList: OrgTraineeFormerOnPeopleListCounts;
  asOf: string | null;
}
