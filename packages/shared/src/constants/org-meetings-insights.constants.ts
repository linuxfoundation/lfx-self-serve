// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgInfluenceRow, OrgLeaderboardRow, OrgMeetingsKpiSummary, OrgMeetingsSpendBreakdown, OrgMeetingsTrend } from '@lfx-one/shared/interfaces';

/** Valid values for the Org Lens Meetings time-range dropdown, in display order. */
export const ORG_MEETINGS_TIME_RANGES = [
  'past90d',
  'past180d',
  'past365d',
  'previousQuarter',
  'previousYear',
  'previous5y',
  'previous10y',
  'allTime',
  'custom',
] as const;

/** Dropdown-row labels for each time range. */
export const ORG_MEETINGS_TIME_RANGE_LABELS: Record<(typeof ORG_MEETINGS_TIME_RANGES)[number], string> = {
  past90d: 'Past 90 days',
  past180d: 'Past 180 days',
  past365d: 'Past 365 days',
  previousQuarter: 'Previous quarter',
  previousYear: 'Previous year',
  previous5y: 'Previous 5 years',
  previous10y: 'Previous 10 years',
  allTime: 'All time',
  custom: 'Custom',
};

/** Groups of time ranges rendered as divider-separated sections in the dropdown, matching the insights.linuxfoundation.org time selector. */
export const ORG_MEETINGS_TIME_RANGE_GROUPS: (typeof ORG_MEETINGS_TIME_RANGES)[number][][] = [
  ['past90d', 'past180d', 'past365d'],
  ['previousQuarter', 'previousYear', 'previous5y', 'previous10y'],
  ['allTime'],
  ['custom'],
];

/** Demo KPI summary — matches the 6a design spec's mock numbers (63 employees / 512 meetings / 47 projects / 30 foundations). */
export const DEMO_ORG_MEETINGS_KPI_SUMMARY: OrgMeetingsKpiSummary = {
  employeesActive: 63,
  employeesActiveDeltaLabel: '+8% vs. prior period',
  employeesActiveDeltaDirection: 'up',
  meetingsAttended: 512,
  meetingsAttendedDeltaLabel: '+12% vs. prior period',
  meetingsAttendedDeltaDirection: 'up',
  projectsSupported: 47,
  projectsSupportedDeltaLabel: '+3% vs. prior period',
  projectsSupportedDeltaDirection: 'up',
  foundationsSupported: 30,
  foundationsSupportedDeltaLabel: 'No change vs. prior period',
  foundationsSupportedDeltaDirection: 'flat',
};

/** Demo "Where your people spend time" segments, seeded from the 6a design spec's mock percentages. */
export const DEMO_ORG_MEETINGS_SPEND: OrgMeetingsSpendBreakdown = {
  byFoundation: [
    { label: 'CNCF', pct: 38 },
    { label: 'AAIF', pct: 24 },
    { label: 'PyTorch Foundation', pct: 11 },
    {
      label: '27 others',
      pct: 27,
      // Up to 20 individual foundations are itemized in the hover breakdown before collapsing the rest.
      others: [
        { label: 'FINOS', pct: 2 },
        { label: 'OpenSSF', pct: 2 },
        { label: 'LF Networking', pct: 2 },
        { label: 'LF Energy', pct: 2 },
        { label: 'Hyperledger Foundation', pct: 2 },
        { label: 'LF AI & Data', pct: 2 },
        { label: 'LF Edge', pct: 1 },
        { label: 'Zephyr Project', pct: 1 },
        { label: 'Academy Software Foundation', pct: 1 },
        { label: 'Continuous Delivery Foundation', pct: 1 },
        { label: 'GraphQL Foundation', pct: 1 },
        { label: 'Open Mainframe Project', pct: 1 },
        { label: 'OpenWallet Foundation', pct: 1 },
        { label: 'JS Foundation', pct: 1 },
        { label: 'R Consortium', pct: 1 },
        { label: 'Open Programmable Infrastructure', pct: 1 },
        { label: 'Unified Cyber Ontology', pct: 1 },
        { label: 'AgStack Foundation', pct: 1 },
        { label: 'Fintech Open Source Foundation', pct: 1 },
        { label: 'OpenChain Project', pct: 1 },
        { label: '7 more foundations', pct: 1 },
      ],
    },
  ],
  byProject: [
    { label: 'Kubernetes', pct: 17 },
    { label: 'Argo', pct: 10 },
    { label: 'PyTorch', pct: 8 },
    {
      label: '44 others',
      pct: 65,
      // Up to 20 individual projects are itemized in the hover breakdown before collapsing the rest.
      others: [
        { label: 'Envoy', pct: 9 },
        { label: 'Helm', pct: 7 },
        { label: 'gRPC', pct: 6 },
        { label: 'containerd', pct: 5 },
        { label: 'OpenTelemetry', pct: 5 },
        { label: 'etcd', pct: 2 },
        { label: 'Prometheus', pct: 2 },
        { label: 'Fluentd', pct: 2 },
        { label: 'Jaeger', pct: 2 },
        { label: 'Vitess', pct: 2 },
        { label: 'CoreDNS', pct: 2 },
        { label: 'Linkerd', pct: 2 },
        { label: 'Rook', pct: 2 },
        { label: 'Harbor', pct: 2 },
        { label: 'Cortex', pct: 2 },
        { label: 'TiKV', pct: 2 },
        { label: 'NATS', pct: 2 },
        { label: 'SPIFFE', pct: 2 },
        { label: 'Falco', pct: 2 },
        { label: 'KEDA', pct: 2 },
        { label: '24 more projects', pct: 3 },
      ],
    },
  ],
  byMeetingType: [
    { label: 'Technical', pct: 56 },
    { label: 'Working Group', pct: 29 },
    { label: 'Board', pct: 9 },
    { label: 'Marketing', pct: 6 },
  ],
  byRole: [
    { label: 'Participant', pct: 64 },
    { label: 'Chair', pct: 18 },
    { label: 'Host', pct: 11 },
    { label: 'Voting Member', pct: 7 },
  ],
};

/** Demo trend cards for "How this has changed over time", seeded from the 6a design spec. */
export const DEMO_ORG_MEETINGS_TRENDS: OrgMeetingsTrend[] = [
  {
    label: 'Meetings Attended',
    value: 512,
    deltaLabel: '+12% vs. prior period',
    deltaDirection: 'up',
    sparkline: [38, 41, 39, 44, 47, 45, 49, 52, 50, 54, 57, 60],
  },
  {
    label: 'Employees Active',
    value: 63,
    deltaLabel: '+8% vs. prior period',
    deltaDirection: 'up',
    sparkline: [44, 46, 45, 48, 50, 49, 53, 55, 54, 58, 60, 63],
  },
  {
    label: 'Projects Supported',
    value: 47,
    deltaLabel: '-4% vs. prior period',
    deltaDirection: 'down',
    sparkline: [53, 52, 54, 51, 50, 51, 49, 48, 49, 48, 47, 47],
  },
];

/** Demo employee leaderboard rows, seeded from the 6a design spec's mock employees. */
export const DEMO_ORG_LEADERBOARD: OrgLeaderboardRow[] = [
  {
    employee: 'Jordan Rivera',
    identity: 'jordan.rivera@example.com',
    // CNCF has both a public and a private meeting, so it renders as two chips: "CNCF" (public) and "Private".
    foundationMeetings: [
      { value: 'CNCF', isPrivate: false },
      { value: 'CNCF', isPrivate: true },
      { value: 'AAIF', isPrivate: true },
    ],
    attended: 94,
    upcoming: 6,
    typeMeetings: [
      { value: 'Technical', isPrivate: false },
      { value: 'Working Group', isPrivate: true },
    ],
    roleMeetings: [
      { value: 'Chair', isPrivate: false },
      { value: 'Participant', isPrivate: true },
    ],
    attendancePct: 92,
  },
  {
    employee: 'Mei Chen',
    identity: 'mei.chen@example.com',
    foundationMeetings: [{ value: 'PyTorch Foundation', isPrivate: false }],
    attended: 81,
    upcoming: 4,
    typeMeetings: [{ value: 'Technical', isPrivate: false }],
    roleMeetings: [
      { value: 'Voting Member', isPrivate: false },
      { value: 'Participant', isPrivate: false },
    ],
    attendancePct: 88,
  },
  {
    employee: 'Priya Okoro',
    identity: 'priya.okoro@example.com',
    // CNCF has both a public and a private meeting, so the public value is shown; Argo is private-only, so it's masked.
    foundationMeetings: [
      { value: 'CNCF', isPrivate: false },
      { value: 'CNCF', isPrivate: true },
      { value: 'Argo', isPrivate: true },
    ],
    attended: 76,
    upcoming: 5,
    // Working Group has both a public and a private meeting, so it's shown; Board is private-only, so it's masked.
    typeMeetings: [
      { value: 'Working Group', isPrivate: false },
      { value: 'Working Group', isPrivate: true },
      { value: 'Board', isPrivate: true },
    ],
    roleMeetings: [
      { value: 'Host', isPrivate: false },
      { value: 'Chair', isPrivate: true },
    ],
    attendancePct: 85,
  },
  {
    employee: 'Sofia Larsson',
    identity: 'sofia.larsson@example.com',
    foundationMeetings: [{ value: 'CNCF', isPrivate: false }],
    attended: 68,
    upcoming: 2,
    typeMeetings: [{ value: 'Technical', isPrivate: false }],
    roleMeetings: [{ value: 'Participant', isPrivate: false }],
    attendancePct: 79,
  },
  {
    employee: 'Diego Ferreira',
    identity: 'diego.ferreira@example.com',
    foundationMeetings: [
      { value: 'AAIF', isPrivate: true },
      { value: 'PyTorch Foundation', isPrivate: false },
    ],
    attended: 59,
    upcoming: 3,
    typeMeetings: [
      { value: 'Marketing', isPrivate: true },
      { value: 'Working Group', isPrivate: false },
    ],
    roleMeetings: [
      { value: 'Participant', isPrivate: true },
      { value: 'Voting Member', isPrivate: false },
    ],
    attendancePct: 73,
  },
  {
    employee: 'Amara Osei',
    identity: 'amara.osei@example.com',
    // Broad cross-foundation contributor with many distinct foundations/types/roles, so the
    // pill cells overflow past VISIBLE_PILL_COUNT — used to exercise the "+N" hover popover.
    foundationMeetings: [
      { value: 'CNCF', isPrivate: false },
      { value: 'CNCF', isPrivate: false },
      { value: 'PyTorch Foundation', isPrivate: false },
      { value: 'AAIF', isPrivate: true },
      { value: 'OpenSSF', isPrivate: false },
      { value: 'FINOS', isPrivate: false },
      { value: 'LF Networking', isPrivate: true },
      { value: 'LF Energy', isPrivate: false },
      { value: 'Hyperledger Foundation', isPrivate: true },
    ],
    attended: 137,
    upcoming: 11,
    typeMeetings: [
      { value: 'Technical', isPrivate: false },
      { value: 'Technical', isPrivate: false },
      { value: 'Working Group', isPrivate: false },
      { value: 'Board', isPrivate: true },
      { value: 'Marketing', isPrivate: false },
      { value: 'Legal', isPrivate: true },
    ],
    roleMeetings: [
      { value: 'Chair', isPrivate: false },
      { value: 'Chair', isPrivate: false },
      { value: 'Voting Member', isPrivate: false },
      { value: 'Host', isPrivate: true },
      { value: 'Participant', isPrivate: false },
      { value: 'Board Member', isPrivate: true },
    ],
    attendancePct: 97,
  },
  {
    employee: 'Marcus Wu',
    identity: 'marcus.wu@example.com',
    // Second broad contributor, all-private-foundation edge case folded in alongside overflow.
    foundationMeetings: [
      { value: 'Kubernetes', isPrivate: false },
      { value: 'Argo', isPrivate: false },
      { value: 'Envoy', isPrivate: true },
      { value: 'Helm', isPrivate: false },
      { value: 'gRPC', isPrivate: true },
      { value: 'containerd', isPrivate: false },
      { value: 'OpenTelemetry', isPrivate: true },
    ],
    attended: 112,
    upcoming: 9,
    typeMeetings: [
      { value: 'Technical', isPrivate: false },
      { value: 'Working Group', isPrivate: false },
      { value: 'Working Group', isPrivate: true },
      { value: 'Board', isPrivate: false },
      { value: 'Marketing', isPrivate: true },
    ],
    roleMeetings: [
      { value: 'Participant', isPrivate: false },
      { value: 'Voting Member', isPrivate: false },
      { value: 'Chair', isPrivate: true },
      { value: 'Host', isPrivate: false },
    ],
    attendancePct: 90,
  },
  {
    employee: 'Renata Silva',
    identity: 'renata.silva@example.com',
    // Every meeting is private, across six distinct foundations and several types — each distinct
    // raw value still gets its own "Private" chip (masking doesn't collapse them into one).
    foundationMeetings: [
      { value: 'CNCF', isPrivate: true },
      { value: 'AAIF', isPrivate: true },
      { value: 'PyTorch Foundation', isPrivate: true },
      { value: 'OpenSSF', isPrivate: true },
      { value: 'FINOS', isPrivate: true },
      { value: 'LF Networking', isPrivate: true },
    ],
    attended: 64,
    upcoming: 5,
    typeMeetings: [
      { value: 'Board', isPrivate: true },
      { value: 'Legal', isPrivate: true },
      { value: 'Technical', isPrivate: true },
      { value: 'Working Group', isPrivate: true },
    ],
    roleMeetings: [
      { value: 'Board Member', isPrivate: true },
      { value: 'Chair', isPrivate: true },
      { value: 'Host', isPrivate: true },
    ],
    attendancePct: 82,
  },
];

/** Demo Ecosystem Influence rows, seeded from the 6a design spec's mock projects (Kubernetes expanded by default). */
export const DEMO_ORG_INFLUENCE_ROWS: OrgInfluenceRow[] = [
  {
    project: 'Kubernetes',
    projectSlug: 'kubernetes',
    projectLink: '/org/projects',
    ecosystemInfluence: 88,
    band: 'leading',
    rankLabel: '#3 of 210',
    rankTier: 'top',
    fromAttendancePct: 15,
    deltaLabel: '+6',
    deltaDirection: 'up',
    breakdown: [
      { label: 'Collaboration Activity', pct: 30 },
      { label: 'Meeting Attendance', pct: 15 },
      { label: 'Event Attendance', pct: 13 },
      { label: 'Committee Members', pct: 11 },
      { label: 'Board Members', pct: 9 },
      { label: 'Event Speakers', pct: 8 },
      { label: 'Meetup Attendance', pct: 6 },
      { label: 'Event Sponsorships', pct: 5 },
      { label: 'Certified Individuals', pct: 3 },
    ],
  },
  {
    project: 'PyTorch',
    projectSlug: 'pytorch',
    projectLink: '/org/projects',
    ecosystemInfluence: 71,
    band: 'contributing',
    rankLabel: '#2 of 96',
    rankTier: 'top',
    fromAttendancePct: 18,
    deltaLabel: '+9',
    deltaDirection: 'up',
    breakdown: [
      { label: 'Collaboration Activity', pct: 28 },
      { label: 'Meeting Attendance', pct: 18 },
      { label: 'Event Attendance', pct: 12 },
      { label: 'Committee Members', pct: 10 },
      { label: 'Board Members', pct: 8 },
      { label: 'Event Speakers', pct: 9 },
      { label: 'Meetup Attendance', pct: 7 },
      { label: 'Event Sponsorships', pct: 5 },
      { label: 'Certified Individuals', pct: 3 },
    ],
  },
  {
    project: 'Argo',
    projectSlug: 'argo',
    projectLink: '/org/projects',
    ecosystemInfluence: 54,
    band: 'participating',
    rankLabel: '#7 of 140',
    rankTier: 'neutral',
    fromAttendancePct: 12,
    deltaLabel: '+3',
    deltaDirection: 'up',
    breakdown: [
      { label: 'Collaboration Activity', pct: 32 },
      { label: 'Meeting Attendance', pct: 12 },
      { label: 'Event Attendance', pct: 14 },
      { label: 'Committee Members', pct: 10 },
      { label: 'Board Members', pct: 8 },
      { label: 'Event Speakers', pct: 8 },
      { label: 'Meetup Attendance', pct: 8 },
      { label: 'Event Sponsorships', pct: 5 },
      { label: 'Certified Individuals', pct: 3 },
    ],
  },
  {
    project: 'Envoy',
    projectSlug: 'envoy',
    projectLink: '/org/projects',
    ecosystemInfluence: 32,
    band: 'silent',
    rankLabel: '#22 of 88',
    rankTier: 'down',
    fromAttendancePct: 9,
    deltaLabel: '−4',
    deltaDirection: 'down',
    breakdown: [
      { label: 'Collaboration Activity', pct: 35 },
      { label: 'Meeting Attendance', pct: 9 },
      { label: 'Event Attendance', pct: 15 },
      { label: 'Committee Members', pct: 11 },
      { label: 'Board Members', pct: 8 },
      { label: 'Event Speakers', pct: 9 },
      { label: 'Meetup Attendance', pct: 7 },
      { label: 'Event Sponsorships', pct: 4 },
      { label: 'Certified Individuals', pct: 2 },
    ],
  },
];
