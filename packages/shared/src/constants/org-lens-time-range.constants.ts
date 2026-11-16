// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensTimeRange, OrgLensTimeRangeOption } from '../interfaces/org-lens-time-range.interface';

// One time-range set for every People tab with a range and the Code Contributions page
// (lfx-self-serve#4159): Insights-style labels, narrowest first, `?range=` in the URL.

/** Valid `?range=` values, narrowest first. Also the BFF's allow-list. */
export const ORG_LENS_TIME_RANGES = ['30d', '90d', '365d', '730d', 'all'] as const;

/** Default range on every Org Lens page — Past 2 years, the window of LFX Insights' organization page (lfx-self-serve#4694). The URL drops `?range=` when it is active. */
export const ORG_LENS_DEFAULT_TIME_RANGE: OrgLensTimeRange = '730d';

/** Query parameter that carries the range in the URL, across People tabs and between People and Code Contributions. */
export const ORG_LENS_TIME_RANGE_QUERY_PARAM = 'range';

/** Window length in days for each bounded range: activity on or after today minus this many days counts. */
export const ORG_LENS_TIME_RANGE_DAYS = { '30d': 30, '90d': 90, '365d': 365, '730d': 730 } as const;

/** Range dropdown options, narrowest first. */
export const ORG_LENS_TIME_RANGE_OPTIONS: readonly OrgLensTimeRangeOption[] = [
  { label: 'Past 30 days', value: '30d' },
  { label: 'Past 90 days', value: '90d' },
  { label: 'Past 365 days', value: '365d' },
  { label: 'Past 2 years', value: '730d' },
  { label: 'All time', value: 'all' },
] as const;

/** Label of the default range, for copy that names the default window ("Past 2 years"). */
export const ORG_LENS_DEFAULT_TIME_RANGE_LABEL: string =
  ORG_LENS_TIME_RANGE_OPTIONS.find((option) => option.value === ORG_LENS_DEFAULT_TIME_RANGE)?.label ?? '';
