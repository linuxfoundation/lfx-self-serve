// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_MEETINGS_SUPPORTED_TIME_RANGES } from '../constants/org-meetings-insights.constants';
import type { OrgMeetingsSupportedTimeRange, OrgMeetingsTimeRange } from '../interfaces/org-meetings-insights.interface';

/**
 * Narrows a dropdown time range to one the meetings endpoints actually serve.
 *
 * Shared so the dropdown's disabled set and the range passed to the endpoints are decided by the
 * same rule; the two drifting apart would let a user pick a window that then 400s.
 */
export function isSupportedOrgMeetingsTimeRange(range: OrgMeetingsTimeRange): range is OrgMeetingsSupportedTimeRange {
  return (ORG_MEETINGS_SUPPORTED_TIME_RANGES as readonly OrgMeetingsTimeRange[]).includes(range);
}
