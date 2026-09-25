// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { HealthMetricsEventsSectionKey } from '../interfaces/health-metrics-events.interface';

/**
 * The nine Events sections in render order. `key` is the section's URL fragment and the scroll-spy
 * allowlist; the DOM id is `sec-evt-<key>`. Footnotes land with each section's data.
 */
export const HEALTH_METRICS_EVENTS_SECTIONS = [
  {
    key: 'forecast',
    label: 'Registration forecast',
    heading: 'Registration forecast',
    description:
      'The most decision-sensitive view in Events: where registrations will land, while there is still time to act. Plotted against days to event so a small meetup and KubeCon can be read the same way.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'past',
    label: 'Past events',
    heading: 'Past events',
    description:
      'Final performance for events that have already closed — the record the registration forecast was projecting toward while they were still open.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'kpi',
    label: 'At a glance',
    heading: 'Events at a glance',
    description: 'Reach across every event this period.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'reg',
    label: 'Registrations & growth',
    heading: 'Registrations & growth',
    description: 'Registrations by year, split in-person versus virtual.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'rev',
    label: 'Revenue',
    heading: 'Event revenue',
    description:
      'The two money lines events generate. Registration revenue is what attendees pay; sponsorship is what companies pay. They are driven by different teams and behave differently, so they are never merged into one figure.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'spon',
    label: 'Sponsorship',
    heading: 'Sponsorship',
    description: 'What companies paid to sponsor events, and what they bought.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'spk',
    label: 'Speakers & proposals',
    heading: 'Speakers & proposals',
    description:
      'The speaking pipeline, kept separate from sponsorship — proposals measure community supply, sponsorship measures revenue. Acceptance rate shows how much choice the programme committee had.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'orgs',
    label: 'Organizations',
    heading: 'Organizations at events',
    description:
      'Which organizations show up, sponsor and speak. This is the events view of an organization — the same company also has a membership, meeting and contribution record in Members.',
    footnote: '',
    footnoteCaution: false,
  },
  {
    key: 'geo',
    label: 'Geographic distribution',
    heading: 'Geographic distribution',
    description: 'Where registrations come from — useful for deciding where the next event should be and which regions are under-served.',
    footnote: '',
    footnoteCaution: false,
  },
] as const;

/** Prefix for a section's DOM id; the fragment is the bare section key. */
export const HEALTH_METRICS_EVENTS_SECTION_ID_PREFIX = 'sec-evt-';

/** Sections whose body reads data, so a deep link waits for them. Each section's issue adds its key. */
export const HEALTH_METRICS_EVENTS_DATA_SECTIONS = [] as const satisfies readonly HealthMetricsEventsSectionKey[];

/** Static note under the sub-nav items; stays plain text until the Members tab exists to link to. */
export const HEALTH_METRICS_EVENTS_SUB_NAV_CROSS_REFERENCE_NOTE = "An organization's event record also appears in Members";

/** The four periods the events views carry as column suffixes, oldest → current. */
export const HEALTH_METRICS_EVENTS_RANGES = ['COMPLETED_YEAR_3', 'COMPLETED_YEAR_2', 'COMPLETED_YEAR', 'YTD'] as const;
