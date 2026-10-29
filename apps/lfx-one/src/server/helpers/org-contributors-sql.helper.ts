// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange } from '@lfx-one/shared/interfaces';
import { orgLensTimeRangeDays } from '@lfx-one/shared/utils';

/**
 * The one window rule for ORG_PEOPLE_CONTRIBUTORS_DAILY reads — People -> Contributors and the Overview's Active
 * Contributors headline: activity on or after N days before today (today included); empty for `all`, the full history
 * the dbt model keeps. Inline, not bound — the day count comes from the allow-listed range — so the planner can fold it.
 */
export function orgContributorsActivityPredicate(range: OrgLensTimeRange): string {
  return range === 'all' ? '' : `AND activity_date >= DATEADD(day, -${orgLensTimeRangeDays(range)}, CURRENT_DATE())`;
}
