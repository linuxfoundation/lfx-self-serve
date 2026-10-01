// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsL2CrossReference } from '../interfaces/health-metrics-l2.interface';
import type { HealthMetricsNonMembersSectionKey } from '../interfaces/health-metrics-non-members.interface';

/**
 * The three Non-Members sections in render order. `key` is the section's URL fragment and the
 * scroll-spy allowlist; the DOM id is `sec-non-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_NON_MEMBERS_SECTIONS = [
  {
    key: 'orgs',
    label: 'Company participation',
    heading: 'Company participation',
    description:
      'Organizations engaging without paying. Ranked by meetings attended first, not code — showing up to meetings means they are already spending staff time, which is the stronger buying signal.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'people',
    label: 'People',
    heading: 'People',
    description: 'The individuals behind those organizations — the actual contact to reach out to. A company is a lead; a person is a conversation.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'conversion',
    label: 'Conversion opportunity',
    heading: 'Conversion opportunity',
    description: 'What the pipeline is worth if the warmest organizations convert. Framed as upside — this section carries no risk badges, only opportunity.',
    footnote: '',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_NON_MEMBERS_SECTION_ID_PREFIX = 'sec-non-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS = [] as const satisfies readonly HealthMetricsNonMembersSectionKey[];

/** Note under the sub-nav items, linking to Engagement's non-member participation. */
export const HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE: HealthMetricsL2CrossReference = {
  text: 'Non-members attending meetings also appear in',
  linkLabel: 'Engagement',
  route: 'engagement',
  fragment: 'nonmem',
};

/** The project selector does not narrow Non-Members, so the page says so above its sections. */
export const HEALTH_METRICS_NON_MEMBERS_SCOPE_NOTE = 'Non-Members figures are foundation-wide. The project selector does not narrow them.';
