// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ORG_LENS_TIME_RANGES } from '../constants/org-lens-time-range.constants';

/** Time range shared by the People tabs (All Employees, Contributors, Event Attendees, Trainees) and Code Contributions. `all` is all time. */
export type OrgLensTimeRange = (typeof ORG_LENS_TIME_RANGES)[number];

/** Range dropdown option — label rendered as-is. */
export interface OrgLensTimeRangeOption {
  label: string;
  value: OrgLensTimeRange;
}
