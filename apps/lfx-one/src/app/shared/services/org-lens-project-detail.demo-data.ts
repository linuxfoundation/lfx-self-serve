// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type {
  OrgLensCardDetailCell,
  OrgLensCardDetailRow,
  OrgLensCardDetailSection,
  OrgLensProjectDetailResponse,
  OrgLensProjectHealth,
  OrgLensProjectInfluenceCard,
  OrgLensProjectLeaderboardRow,
  OrgLensProjectTrendPoint,
} from '@lfx-one/shared/interfaces';

/**
 * Demo company data for the Org Lens · Project Detail sub-page (LFXV2-1885).
 *
 * Real company-data integration (Snowflake / LFX Insights) is a separate story; until then
 * `OrgLensProjectDetailService` serves these fixtures. An unknown slug returns `null` so the
 * page can exercise its not-found (404) state. `jenkins` is intentionally archived (zero org
 * involvement) to exercise the empty-card copy.
 */

interface ProjectDetailSeed {
  name: string;
  description: string;
  foundationLabel: string;
  health: OrgLensProjectHealth;
  sourceUrl: string;
  firstCommit: string;
  softwareValueUsd: number;
  /** The org's own counts (rolling 365d). */
  org: { maintainers: number; contributors: number; commits: number; prs: number };
  /** Project-wide totals (rolling 365d) used as the `% of all` denominators. */
  totals: { maintainers: number; contributors: number; commits: number; prs: number };
  ecosystem: { collaboration: number; meetingAttendance: number; boardMembers: number; committeeMembers: number };
  /** The org's current influence scores; drive the trend chart endpoint + the org's leaderboard rank. */
  influence: { combined: number; technical: number; ecosystem: number };
}

const SEEDS: Record<string, ProjectDetailSeed> = {
  kubernetes: {
    name: 'Kubernetes',
    description: 'Kubernetes (K8s) is an open-source system for automating deployment, scaling, and management of containerized applications.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'excellent',
    sourceUrl: 'https://github.com/kubernetes/kubernetes',
    firstCommit: '2013-07-01',
    softwareValueUsd: 6000000000,
    org: { maintainers: 5, contributors: 6, commits: 1840, prs: 624 },
    totals: { maintainers: 78, contributors: 612, commits: 32940, prs: 11280 },
    ecosystem: { collaboration: 1472, meetingAttendance: 7, boardMembers: 1, committeeMembers: 4 },
    influence: { combined: 70.1, technical: 71.5, ecosystem: 64.0 },
  },
  prometheus: {
    name: 'Prometheus',
    description: 'The monitoring system and time-series database.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'excellent',
    sourceUrl: 'https://github.com/prometheus/prometheus',
    firstCommit: '2012-11-24',
    softwareValueUsd: 214000000,
    org: { maintainers: 2, contributors: 3, commits: 612, prs: 208 },
    totals: { maintainers: 26, contributors: 198, commits: 7180, prs: 2410 },
    ecosystem: { collaboration: 388, meetingAttendance: 3, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 61.4, technical: 64.2, ecosystem: 52.8 },
  },
  envoy: {
    name: 'Envoy',
    description: 'Cloud-native high-performance edge/middle/service proxy.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'healthy',
    sourceUrl: 'https://github.com/envoyproxy/envoy',
    firstCommit: '2016-08-30',
    softwareValueUsd: 178000000,
    org: { maintainers: 3, contributors: 2, commits: 503, prs: 171 },
    totals: { maintainers: 21, contributors: 156, commits: 6020, prs: 2010 },
    ecosystem: { collaboration: 296, meetingAttendance: 2, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 58.0, technical: 62.1, ecosystem: 47.4 },
  },
  opentelemetry: {
    name: 'OpenTelemetry',
    description: 'High-quality, ubiquitous, portable telemetry.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'excellent',
    sourceUrl: 'https://github.com/open-telemetry',
    firstCommit: '2019-05-07',
    softwareValueUsd: 142000000,
    org: { maintainers: 2, contributors: 4, commits: 588, prs: 196 },
    totals: { maintainers: 24, contributors: 230, commits: 8120, prs: 2720 },
    ecosystem: { collaboration: 412, meetingAttendance: 4, boardMembers: 0, committeeMembers: 2 },
    influence: { combined: 63.2, technical: 60.4, ecosystem: 68.1 },
  },
  argo: {
    name: 'Argo',
    description: 'Kubernetes-native workflows, events, CD and rollouts.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'healthy',
    sourceUrl: 'https://github.com/argoproj',
    firstCommit: '2017-08-21',
    softwareValueUsd: 96400000,
    org: { maintainers: 1, contributors: 2, commits: 412, prs: 138 },
    totals: { maintainers: 18, contributors: 184, commits: 4920, prs: 1640 },
    ecosystem: { collaboration: 318, meetingAttendance: 3, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 55.6, technical: 58.3, ecosystem: 46.2 },
  },
  pytorch: {
    name: 'PyTorch',
    description: 'Tensors and dynamic neural networks with strong GPU acceleration.',
    foundationLabel: 'LF AI & Data',
    health: 'excellent',
    sourceUrl: 'https://github.com/pytorch/pytorch',
    firstCommit: '2016-08-13',
    softwareValueUsd: 642000000,
    org: { maintainers: 3, contributors: 4, commits: 980, prs: 332 },
    totals: { maintainers: 34, contributors: 308, commits: 14200, prs: 4760 },
    ecosystem: { collaboration: 706, meetingAttendance: 5, boardMembers: 1, committeeMembers: 2 },
    influence: { combined: 66.0, technical: 68.2, ecosystem: 60.5 },
  },
  onnx: {
    name: 'ONNX',
    description: 'Open standard for machine-learning interoperability.',
    foundationLabel: 'LF AI & Data',
    health: 'healthy',
    sourceUrl: 'https://github.com/onnx/onnx',
    firstCommit: '2017-09-07',
    softwareValueUsd: 58200000,
    org: { maintainers: 1, contributors: 2, commits: 214, prs: 72 },
    totals: { maintainers: 16, contributors: 132, commits: 3420, prs: 1140 },
    ecosystem: { collaboration: 168, meetingAttendance: 2, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 47.8, technical: 51.0, ecosystem: 41.3 },
  },
  onap: {
    name: 'ONAP',
    description: 'Open Network Automation Platform.',
    foundationLabel: 'LF Networking',
    health: 'at-risk',
    sourceUrl: 'https://github.com/onap',
    firstCommit: '2017-02-15',
    softwareValueUsd: 39400000,
    org: { maintainers: 1, contributors: 1, commits: 118, prs: 40 },
    totals: { maintainers: 14, contributors: 96, commits: 2310, prs: 770 },
    ecosystem: { collaboration: 84, meetingAttendance: 1, boardMembers: 0, committeeMembers: 0 },
    influence: { combined: 38.2, technical: 40.1, ecosystem: 34.6 },
  },
  'fd-io': {
    name: 'FD.io',
    description: 'Fast data-plane I/O for the network stack.',
    foundationLabel: 'LF Networking',
    health: 'at-risk',
    sourceUrl: 'https://github.com/FDio',
    firstCommit: '2016-02-11',
    softwareValueUsd: 21800000,
    org: { maintainers: 0, contributors: 1, commits: 62, prs: 21 },
    totals: { maintainers: 11, contributors: 74, commits: 1480, prs: 494 },
    ecosystem: { collaboration: 41, meetingAttendance: 0, boardMembers: 0, committeeMembers: 0 },
    influence: { combined: 33.9, technical: 36.4, ecosystem: 29.0 },
  },
  sigstore: {
    name: 'Sigstore',
    description: 'A new standard for signing, verifying and protecting software.',
    foundationLabel: 'OpenSSF',
    health: 'healthy',
    sourceUrl: 'https://github.com/sigstore',
    firstCommit: '2020-12-08',
    softwareValueUsd: 47600000,
    org: { maintainers: 2, contributors: 2, commits: 318, prs: 106 },
    totals: { maintainers: 17, contributors: 128, commits: 4510, prs: 1500 },
    ecosystem: { collaboration: 214, meetingAttendance: 2, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 56.0, technical: 58.4, ecosystem: 50.1 },
  },
  'in-toto': {
    name: 'in-toto',
    description: 'A framework to secure the integrity of software supply chains.',
    foundationLabel: 'OpenSSF',
    health: 'healthy',
    sourceUrl: 'https://github.com/in-toto',
    firstCommit: '2017-06-12',
    softwareValueUsd: 18900000,
    org: { maintainers: 1, contributors: 1, commits: 142, prs: 48 },
    totals: { maintainers: 12, contributors: 84, commits: 2210, prs: 736 },
    ecosystem: { collaboration: 76, meetingAttendance: 1, boardMembers: 0, committeeMembers: 0 },
    influence: { combined: 44.3, technical: 46.8, ecosystem: 38.0 },
  },
  tekton: {
    name: 'Tekton',
    description: 'Cloud-native CI/CD building blocks.',
    foundationLabel: 'CD Foundation',
    health: 'healthy',
    sourceUrl: 'https://github.com/tektoncd',
    firstCommit: '2018-08-10',
    softwareValueUsd: 34200000,
    org: { maintainers: 1, contributors: 2, commits: 256, prs: 86 },
    totals: { maintainers: 15, contributors: 112, commits: 3990, prs: 1330 },
    ecosystem: { collaboration: 142, meetingAttendance: 2, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 51.0, technical: 54.2, ecosystem: 42.6 },
  },
  jenkins: {
    name: 'Jenkins',
    description: 'The leading open-source automation server.',
    foundationLabel: 'CD Foundation',
    health: 'at-risk',
    sourceUrl: 'https://github.com/jenkinsci',
    firstCommit: '2011-02-02',
    softwareValueUsd: 12400000,
    // Archived in our workspace — the org has no current maintainers/contributors here (empty-card demo).
    org: { maintainers: 0, contributors: 0, commits: 0, prs: 0 },
    totals: { maintainers: 19, contributors: 88, commits: 2040, prs: 680 },
    ecosystem: { collaboration: 0, meetingAttendance: 0, boardMembers: 0, committeeMembers: 0 },
    influence: { combined: 0, technical: 0, ecosystem: 0 },
  },
  'spiffe-spire': {
    name: 'SPIFFE / SPIRE',
    description: 'A universal identity control plane for distributed systems.',
    foundationLabel: 'Cloud Native Computing Foundation',
    health: 'healthy',
    sourceUrl: 'https://github.com/spiffe',
    firstCommit: '2018-01-26',
    softwareValueUsd: 41100000,
    org: { maintainers: 2, contributors: 3, commits: 372, prs: 124 },
    totals: { maintainers: 16, contributors: 120, commits: 5230, prs: 1740 },
    ecosystem: { collaboration: 198, meetingAttendance: 2, boardMembers: 0, committeeMembers: 1 },
    influence: { combined: 60.0, technical: 62.3, ecosystem: 54.8 },
  },
};

/** Twelve year-month bins ending at the current month (oldest → newest), e.g. "2025-07". */
function trailing12Months(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** Deterministic 12-point ramp ending at `end` (starts ~`startFactor` of it). No RNG → SSR-stable. */
function ramp(end: number, startFactor: number, round = 0): number[] {
  if (end === 0) return Array.from({ length: 12 }, () => 0);
  const start = end * startFactor;
  const step = (end - start) / 11;
  const factor = 10 ** round;
  return Array.from({ length: 12 }, (_, i) => Math.round((start + step * i) * factor) / factor);
}

function pctStr(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function shareOf(n: number, total: number): number {
  return total === 0 ? 0 : n / total;
}

interface Caption {
  prefix: string;
  emphasis: string;
  suffix: string;
}

function card(
  key: string,
  label: string,
  scopeLabel: string | null,
  sparkline: number[],
  projectSparkline: number[],
  caption: Caption
): OrgLensProjectInfluenceCard {
  return { key, label, scopeLabel, sparkline, projectSparkline, caption };
}

/** Five technical cards (project-level): contribution metrics + PR merge speed. */
function technicalCards(seed: ProjectDetailSeed): OrgLensProjectInfluenceCard[] {
  const { org, totals } = seed;
  const mergeSlower = Math.round((100 - seed.influence.technical) * 0.4 * 100) / 100;
  // Project-average series: derived from totals divided by estimated active-contributor counts.
  // Maintainers are concentrated (~15 orgs each with meaningful presence); contributors are spread
  // across ~90 orgs; commits/PRs are driven by ~20 high-volume orgs.
  const projMaintainers = ramp(totals.maintainers / 15, 0.7);
  const projContributors = ramp(totals.contributors / 90, 0.7);
  const projCommits = ramp(totals.commits / 20, 0.7);
  const projPrs = ramp(totals.prs / 20, 0.7);
  // Merge-time baseline: 50 represents a project-neutral average (0=instant, 100=very slow).
  const projMergeTime = ramp(50, 0.92, 1);
  return [
    card(
      'maintainers',
      'Maintainers',
      null,
      ramp(org.maintainers, 0.6),
      projMaintainers,
      org.maintainers === 0
        ? { prefix: 'Our company employs ', emphasis: 'no', suffix: ' maintainers for this project.' }
        : {
            prefix: 'Our company employs ',
            emphasis: `${org.maintainers}`,
            suffix: ` ${org.maintainers === 1 ? 'maintainer' : 'maintainers'} for this project.`,
          }
    ),
    card('contributors', 'Contributors', null, ramp(org.contributors, 0.55), projContributors, {
      prefix: 'Our company employs ',
      emphasis: pctStr(shareOf(org.contributors, totals.contributors)),
      suffix: ' of contributors to this project.',
    }),
    card('commits', 'Commit Activities', null, ramp(org.commits, 0.65), projCommits, {
      prefix: 'Employees made ',
      emphasis: pctStr(shareOf(org.commits, totals.commits)),
      suffix: ' of all commit activities.',
    }),
    card('pull-requests', 'Pull Requests Opened', null, ramp(org.prs, 0.65), projPrs, {
      prefix: 'Employees opened ',
      emphasis: pctStr(shareOf(org.prs, totals.prs)),
      suffix: ' of all pull requests.',
    }),
    card('avg-merge-time', 'Avg Time to Merge PRs', null, ramp(100 - seed.influence.technical, 0.85, 1), projMergeTime, {
      prefix: 'PRs merged ',
      emphasis: `${mergeSlower}% slower`,
      suffix: ' than average.',
    }),
  ];
}

/** Nine ecosystem cards: collaboration + meetings are project-level; the rest are foundation-level. */
function ecosystemCards(seed: ProjectDetailSeed, projectName: string, foundation: string): OrgLensProjectInfluenceCard[] {
  const eco = seed.ecosystem;
  const e = seed.influence.ecosystem;
  // Denominators picked so Kubernetes lands on the prototype's 9.6% / 1.1%.
  const collabPct = eco.collaboration === 0 ? 0 : Math.round((eco.collaboration / 15333) * 1000) / 1000;
  const committeePct = eco.committeeMembers === 0 ? 0 : Math.round((eco.committeeMembers / 364) * 1000) / 1000;
  // Foundation-level event/training shares scale off the ecosystem influence score.
  const eventAttPct = Math.round((e / 100) * 0.95 * 1000) / 1000;
  const speakerPct = Math.round((e / 100) * 0.038 * 1000) / 1000;
  const sponsorPct = Math.round((e / 100) * 0.04 * 1000) / 1000;
  const meetupPct = Math.round((e / 100) * 0.013 * 1000) / 1000;
  const certifiedPct = Math.round((e / 100) * 0.005 * 1000) / 1000;
  // Project-average proxies for ecosystem metrics (org is expected to be above avg for its band).
  const projCollabAvg = ramp(eco.collaboration > 0 ? 15333 / 15 : 0, 0.65);
  const projMeetingAvg = eco.meetingAttendance === 0 ? [] : ramp(eco.meetingAttendance * 0.78, 0.65);
  const projBoardAvg = eco.boardMembers === 0 ? [] : ramp(eco.boardMembers * 0.7, 0.65);
  const projCommitteeAvg = eco.committeeMembers === 0 ? [] : ramp(eco.committeeMembers * 0.8, 0.65);

  return [
    card(
      'collaboration',
      'Collaboration Activity',
      projectName,
      ramp(eco.collaboration, 0.6),
      projCollabAvg,
      eco.collaboration === 0
        ? { prefix: 'No collaboration activity recorded for this project.', emphasis: '', suffix: '' }
        : { prefix: 'Employees contributed ', emphasis: pctStr(collabPct), suffix: ' of all collaboration activities.' }
    ),
    card(
      'meeting-attendance',
      'Meeting Attendance',
      projectName,
      eco.meetingAttendance === 0 ? [] : ramp(eco.meetingAttendance, 0.6),
      projMeetingAvg,
      eco.meetingAttendance === 0
        ? { prefix: 'Our company has no meeting attendance for this project.', emphasis: '', suffix: '' }
        : { prefix: 'Org reps attended ', emphasis: `${eco.meetingAttendance}`, suffix: ` project ${eco.meetingAttendance === 1 ? 'meeting' : 'meetings'}.` }
    ),
    card(
      'board-members',
      'Board Members',
      foundation,
      eco.boardMembers === 0 ? [] : ramp(eco.boardMembers, 0.6),
      projBoardAvg,
      eco.boardMembers === 0
        ? { prefix: `Your organization holds no board seats in ${foundation}.`, emphasis: '', suffix: '' }
        : {
            prefix: 'Our company employs ',
            emphasis: `${eco.boardMembers} board ${eco.boardMembers === 1 ? 'member' : 'members'}`,
            suffix: ` for ${foundation}.`,
          }
    ),
    card(
      'committee-members',
      'Committee Members',
      foundation,
      eco.committeeMembers === 0 ? [] : ramp(eco.committeeMembers, 0.6),
      projCommitteeAvg,
      eco.committeeMembers === 0
        ? { prefix: `Your organization holds no committee seats in ${foundation}.`, emphasis: '', suffix: '' }
        : { prefix: 'Employees make up ', emphasis: pctStr(committeePct), suffix: ' of all committee members.' }
    ),
    card('event-attendance', 'Event Attendance', foundation, ramp(eventAttPct * 100, 0.78, 1), ramp(eventAttPct * 100 * 0.8, 0.72, 1), {
      prefix: 'Employees attended ',
      emphasis: pctStr(eventAttPct),
      suffix: ` of all ${foundation} events.`,
    }),
    card('event-speakers', 'Event Speakers', foundation, ramp(speakerPct * 100, 0.78, 2), ramp(speakerPct * 100 * 0.8, 0.72, 2), {
      prefix: 'Employees represented ',
      emphasis: pctStr(speakerPct),
      suffix: ` of all speakers at ${foundation} events.`,
    }),
    card('event-sponsorships', 'Event Sponsorships', foundation, ramp(sponsorPct * 100, 0.78, 2), ramp(sponsorPct * 100 * 0.8, 0.72, 2), {
      prefix: 'Our company reached ',
      emphasis: pctStr(sponsorPct),
      suffix: ' of attendees through sponsorship.',
    }),
    card('meetup-attendance', 'Meetup Attendance', foundation, ramp(meetupPct * 100, 0.78, 2), ramp(meetupPct * 100 * 0.8, 0.72, 2), {
      prefix: 'Employees attended ',
      emphasis: pctStr(meetupPct),
      suffix: ` of all ${foundation} meetups.`,
    }),
    card('certified-individuals', 'Certified Individuals', foundation, ramp(certifiedPct * 100, 0.78, 2), ramp(certifiedPct * 100 * 0.8, 0.72, 2), {
      prefix: 'Employees make up ',
      emphasis: pctStr(certifiedPct),
      suffix: ' of all certified individuals.',
    }),
  ];
}

function trendSeries(seed: ProjectDetailSeed): OrgLensProjectTrendPoint[] {
  const months = trailing12Months();
  const combined = ramp(seed.influence.combined, 0.83, 1);
  const technical = ramp(seed.influence.technical, 0.85, 1);
  const ecosystem = ramp(seed.influence.ecosystem, 0.8, 1);
  return months.map((month, i) => ({ month, combined: combined[i], technical: technical[i], ecosystem: ecosystem[i] }));
}

/**
 * Competitor pool with relative strength (0..1) plus per-org technical / ecosystem biases so the
 * score-type toggle genuinely re-ranks (an org strong technically but weak on ecosystem moves).
 */
const COMPETITORS: { name: string; strength: number; techBias: number; ecoBias: number }[] = [
  { name: 'Google', strength: 1.0, techBias: 1.05, ecoBias: 0.92 },
  { name: 'Red Hat', strength: 0.92, techBias: 0.96, ecoBias: 1.12 },
  { name: 'Microsoft', strength: 0.86, techBias: 1.08, ecoBias: 0.9 },
  { name: 'Amazon', strength: 0.79, techBias: 1.02, ecoBias: 0.95 },
  { name: 'VMware', strength: 0.72, techBias: 0.93, ecoBias: 1.1 },
  { name: 'IBM', strength: 0.65, techBias: 0.9, ecoBias: 1.15 },
  { name: 'Intel', strength: 0.58, techBias: 1.07, ecoBias: 0.88 },
  { name: 'SUSE', strength: 0.5, techBias: 0.98, ecoBias: 1.04 },
  { name: 'Huawei', strength: 0.43, techBias: 1.04, ecoBias: 0.86 },
  { name: 'Independent contributors', strength: 0.32, techBias: 1.0, ecoBias: 0.8 },
];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function leaderboard(seed: ProjectDetailSeed, orgName: string): OrgLensProjectLeaderboardRow[] {
  // Top score scales with the project's prominence; the viewing org sits at its own influence scores.
  const topScore = Math.min(95, Math.max(58, seed.influence.combined * 1.32));
  const rows: OrgLensProjectLeaderboardRow[] = COMPETITORS.map((c) => {
    const combined = round1(c.strength * topScore);
    return {
      orgName: c.name,
      orgLogoUrl: '',
      scores: { combined, technical: round1(Math.min(99, combined * c.techBias)), ecosystem: round1(Math.min(99, combined * c.ecoBias)) },
      activityCount: Math.round(combined * 46),
      trendSparkline: ramp(combined, 0.86, 1),
      trendDeltaPct: deltaFromSparkline(ramp(combined, 0.86, 1)),
      isViewingOrg: false,
    };
  });

  const viewingSpark = ramp(seed.influence.combined, 0.82, 1);
  rows.push({
    orgName: orgName || 'Your organization',
    orgLogoUrl: '',
    scores: { combined: round1(seed.influence.combined), technical: round1(seed.influence.technical), ecosystem: round1(seed.influence.ecosystem) },
    activityCount: Math.round(seed.influence.combined * 46),
    trendSparkline: viewingSpark,
    trendDeltaPct: deltaFromSparkline(viewingSpark),
    isViewingOrg: true,
  });

  return rows;
}

function deltaFromSparkline(series: number[]): number {
  const start = series[0];
  return start === 0 ? 0 : Math.round(((series[series.length - 1] - start) / start) * 100) / 100;
}

const CNCF_ARTWORK = 'https://raw.githubusercontent.com/cncf/artwork/master/projects';
const PROJECT_LOGO_URLS: Record<string, string> = {
  kubernetes: `${CNCF_ARTWORK}/kubernetes/icon/color/kubernetes-icon-color.svg`,
  argo: `${CNCF_ARTWORK}/argo/icon/color/argo-icon-color.svg`,
};

// ---------------------------------------------------------------------------
// Card detail drawer data — definition table + card-specific data tables
// ---------------------------------------------------------------------------

/** Demo people names used across all card detail tables. */
const DEMO_PEOPLE = [
  'Alex Chen',
  'Jordan Miller',
  'Sam Patel',
  'Casey Thompson',
  'Morgan Davis',
  'Riley Anderson',
  'Taylor Brown',
  'Quinn Wilson',
  'Avery Johnson',
  'Blake Lee',
];

const DEMO_COMMITS = [
  'Fix race condition in scheduler',
  'Add unit tests for auth module',
  'Refactor API error handling',
  'Update dependency versions',
  'Improve performance of query path',
];

const DEMO_PRS = [
  'feat: add pod disruption budget support',
  'fix: race condition in scheduler',
  'docs: update API reference',
  'refactor: improve error handling',
  'feat: implement resource quotas',
];

/** Month+year dates (static for SSR stability). */
const MONTH_DATES = ['Mar 2023', 'Jun 2024', 'Sep 2024', 'Nov 2024', 'Jan 2025', 'Apr 2025'];

/** Full dates (static for SSR stability). */
const FULL_DATES = ['Mar 15, 2024', 'Jun 22, 2024', 'Sep 8, 2024', 'Nov 30, 2024', 'Jan 14, 2025', 'Apr 5, 2025'];

const DEMO_COMMITTEES = ['Technical Oversight Committee', 'Security TAG', 'Storage TAG', 'App Delivery TAG', 'Runtime TAG'];

function personCell(i: number, pool: string[] = DEMO_PEOPLE): OrgLensCardDetailCell {
  return { person: { name: pool[i % pool.length] } };
}

function textCell(value: string): OrgLensCardDetailCell {
  return { text: value };
}

function row(...cells: OrgLensCardDetailCell[]): OrgLensCardDetailRow {
  return { cells };
}

/** Generates drawer detail data for all influence cards in a project. */
function buildCardDetails(seed: ProjectDetailSeed): Record<string, OrgLensCardDetailSection> {
  const { org, totals } = seed;
  const eco = seed.ecosystem;
  const repoGroup = seed.name.split(' ')[0].toLowerCase();

  return {
    maintainers: {
      definition: {
        text: 'Individuals granted maintainer status with merge rights and code ownership for this project.',
        totalType: 'count',
        total: totals.maintainers.toString(),
        dataSource: 'LFX Insights',
      },
      columns: ['Our Contributors', 'Username', 'Granted Maintainer Status'],
      rows: Array.from({ length: Math.min(org.maintainers, 5) }, (_, i) =>
        row(personCell(i), textCell('@' + DEMO_PEOPLE[i % DEMO_PEOPLE.length].toLowerCase().replace(' ', '.')), textCell('MAINTAINERS.md'))
      ),
    },

    contributors: {
      definition: {
        text: 'Individuals who made at least one contribution (commit, PR, review, or comment) in the selected time range.',
        totalType: 'count',
        total: totals.contributors.toLocaleString(),
        dataSource: 'LFX Insights',
      },
      columns: ['Our Contributors', 'Username', 'First activity', 'Most recent', '# Contributions'],
      rows: Array.from({ length: Math.min(org.contributors, 5) }, (_, i) =>
        row(
          personCell(i),
          textCell('@' + DEMO_PEOPLE[i % DEMO_PEOPLE.length].toLowerCase().replace(' ', '.')),
          textCell(MONTH_DATES[i % MONTH_DATES.length]),
          textCell(MONTH_DATES[(i + 2) % MONTH_DATES.length]),
          textCell(String(Math.max(1, Math.round(org.commits / Math.max(1, org.contributors)) + i * 3)))
        )
      ),
    },

    commits: {
      definition: {
        text: "Code contributions committed directly to this project's repositories.",
        totalType: 'count',
        total: totals.commits.toLocaleString(),
        dataSource: 'LFX Insights',
      },
      columns: ['Repository Group', 'Committer', 'Date', 'Commit'],
      rows:
        org.commits === 0
          ? []
          : DEMO_COMMITS.slice(0, 5).map((commit, i) => row(textCell(repoGroup), personCell(i), textCell(FULL_DATES[i % FULL_DATES.length]), textCell(commit))),
    },

    'pull-requests': {
      definition: {
        text: "Pull requests opened against this project's repositories in the selected time range.",
        totalType: 'count',
        total: totals.prs.toLocaleString(),
        dataSource: 'LFX Insights',
      },
      columns: ['Repository Group', 'Committer', 'Date', 'PR Opened'],
      rows:
        org.prs === 0
          ? []
          : DEMO_PRS.slice(0, 5).map((pr, i) => row(textCell(repoGroup), personCell(i), textCell(FULL_DATES[i % FULL_DATES.length]), textCell(pr))),
    },

    'avg-merge-time': {
      definition: {
        text: "Average time from when a pull request is opened to when it is merged, for your organization's contributors.",
        totalType: 'average',
        total: '48.3 days',
        dataSource: 'LFX Insights',
      },
      columns: ['Repo', 'Our Contributors', 'PR Name', 'Date', 'Merge Time'],
      rows:
        org.prs === 0
          ? []
          : DEMO_PRS.slice(0, 5).map((pr, i) =>
              row(
                textCell(repoGroup),
                personCell(i),
                textCell(pr),
                textCell(FULL_DATES[i % FULL_DATES.length]),
                textCell(String(Math.round(40 + i * 3)) + ' days')
              )
            ),
    },

    collaboration: {
      definition: {
        text: 'Interactions across collaboration platforms including Slack, mailing lists, GitHub Issues, Jira, and community forums.',
        totalType: 'count',
        total: '15,333',
        dataSource: 'Confluence / Jira / GitHub / GitLab / Groups.io / Slack',
      },
      columns: ['Source', 'Our Collaborators', 'Location', 'Count', 'Most recent'],
      rows:
        eco.collaboration === 0
          ? []
          : ['GitHub', 'Slack', 'Groups.io', 'Jira'].map((source, i) =>
              row(
                textCell(source),
                personCell(i),
                textCell(['Issues & PRs', '#general channel', 'dev mailing list', 'Project board'][i]),
                textCell(String(Math.max(1, Math.round(eco.collaboration * (0.35 - i * 0.06))))),
                textCell(FULL_DATES[(i + 1) % FULL_DATES.length])
              )
            ),
    },

    'meeting-attendance': {
      definition: {
        text: 'Attendance at project committee, working group, and community meetings.',
        totalType: 'count',
        total: String(Math.max(1, Math.round(eco.meetingAttendance / 0.115))),
        dataSource: 'LFX',
      },
      columns: ['Our meeting attendees', 'Meeting type', 'Meeting date'],
      rows:
        eco.meetingAttendance === 0
          ? []
          : ['Contributor Meeting', 'Technical Steering Committee', 'Community Call']
              .slice(0, Math.min(eco.meetingAttendance, 3))
              .map((type, i) => row(personCell(i), textCell(type), textCell(FULL_DATES[(i + 2) % FULL_DATES.length]))),
    },

    'board-members': {
      definition: {
        text: "Seat on the governing board of the project's foundation.",
        totalType: 'count',
        total: '55',
        dataSource: 'LFX',
      },
      columns: ['Our board members', 'Added to board', 'Granted seat by'],
      rows: Array.from({ length: Math.min(eco.boardMembers, 5) }, (_, i) =>
        row(
          personCell(i, ['Bridget Cromwell', 'Alexander Levan', 'Morgan Thompson', 'Casey Williams', 'Jordan Park']),
          textCell(MONTH_DATES[i % MONTH_DATES.length]),
          textCell('Membership Entitlement')
        )
      ),
    },

    'committee-members': {
      definition: {
        text: 'Individual who is on a foundation committee, such as advisory groups, steering committees, and marketing committees.',
        totalType: 'count',
        total: '1,764',
        dataSource: 'LFX',
      },
      columns: ['Our committee members', 'Committee', 'Date joined'],
      rows: Array.from({ length: Math.min(eco.committeeMembers, 5) }, (_, i) =>
        row(personCell(i), textCell(DEMO_COMMITTEES[i % DEMO_COMMITTEES.length]), textCell(FULL_DATES[i % FULL_DATES.length]))
      ),
    },

    'event-attendance': {
      definition: {
        text: "Registration and attendance at events hosted or co-located with this project's foundation.",
        totalType: 'count',
        total: '2,840',
        dataSource: 'LFX',
      },
      columns: ['Our attendees', 'Event name', 'Date', 'Location'],
      rows: [
        row(personCell(0), textCell('KubeCon EU 2025'), textCell('Mar 2025'), textCell('London, UK')),
        row(personCell(1), textCell('KubeCon NA 2024'), textCell('Nov 2024'), textCell('Salt Lake City, UT')),
        row(personCell(2), textCell('CloudNativeCon NA 2024'), textCell('Nov 2024'), textCell('Salt Lake City, UT')),
      ],
    },

    'event-speakers': {
      definition: {
        text: 'Employees who presented talks, workshops, or keynotes at foundation-hosted events.',
        totalType: 'count',
        total: '184',
        dataSource: 'LFX',
      },
      columns: ['Our speakers', 'Event name', 'Talk title', 'Date'],
      rows: [
        row(personCell(0), textCell('KubeCon EU 2025'), textCell('Building Secure Software Supply Chains'), textCell('Mar 2025')),
        row(personCell(1), textCell('KubeCon NA 2024'), textCell('Scaling Multi-Cluster Deployments'), textCell('Nov 2024')),
      ],
    },

    'event-sponsorships': {
      definition: {
        text: 'Events where your organization sponsored, co-sponsored, or provided in-kind support.',
        totalType: 'count',
        total: '12',
        dataSource: 'LFX',
      },
      columns: ['Event name', 'Date', 'Sponsorship level', 'Reach'],
      rows: [
        row(textCell('KubeCon EU 2025'), textCell('Mar 2025'), textCell('Diamond'), textCell('12,400 attendees')),
        row(textCell('KubeCon NA 2024'), textCell('Nov 2024'), textCell('Gold'), textCell('8,200 attendees')),
      ],
    },

    'meetup-attendance': {
      definition: {
        text: "Attendance at community meetups organized under this project's foundation.",
        totalType: 'count',
        total: '1,240',
        dataSource: 'LFX',
      },
      columns: ['Our attendees', 'Meetup name', 'Date', 'Location'],
      rows: [
        row(personCell(0), textCell(seed.name + ' Meetup Seattle'), textCell('Jan 2025'), textCell('Seattle, WA')),
        row(personCell(1), textCell(seed.name + ' Meetup New York'), textCell('Oct 2024'), textCell('New York, NY')),
      ],
    },

    'certified-individuals': {
      definition: {
        text: "Employees who hold active certifications issued or recognized by this project's foundation.",
        totalType: 'count',
        total: '4,210',
        dataSource: 'LFX',
      },
      columns: ['Our individuals', 'Certification name', 'Date issued'],
      rows: [
        row(personCell(0), textCell('Certified Kubernetes Administrator (CKA)'), textCell(FULL_DATES[0])),
        row(personCell(1), textCell('Certified Kubernetes Application Developer (CKAD)'), textCell(FULL_DATES[1])),
        row(personCell(2), textCell('Certified Kubernetes Security Specialist (CKS)'), textCell(FULL_DATES[2])),
      ],
    },
  };
}

/**
 * Demo detail for one project. Returns `null` for an unknown slug so the page renders its
 * not-found (404) state. `orgUid` echoes into the response envelope; `orgName` personalizes
 * the viewing-org leaderboard row.
 */
export function getDemoProjectDetail(orgUid: string, orgName: string, projectSlug: string): OrgLensProjectDetailResponse | null {
  const seed = SEEDS[projectSlug];
  if (!seed) return null;

  return {
    accountId: orgUid,
    projectSlug,
    hero: {
      projectName: seed.name,
      description: seed.description,
      logoUrl: PROJECT_LOGO_URLS[projectSlug] ?? '',
      sourceUrl: seed.sourceUrl,
      sourceLabel: `${seed.name} - ${seed.description.replace(/\.$/, '')}`,
      lfxInsightsUrl: `https://insights.linuxfoundation.org/project/${projectSlug}`,
      firstCommit: seed.firstCommit,
      softwareValueUsd: seed.softwareValueUsd,
      health: seed.health,
      foundationLabel: seed.foundationLabel,
      // Static demo build timestamp (~1h ago) so the freshness label renders a stable relative value.
      lastUpdated: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    },
    technical: technicalCards(seed),
    ecosystem: ecosystemCards(seed, seed.name, seed.foundationLabel),
    trend: trendSeries(seed),
    leaderboard: leaderboard(seed, orgName),
    cardDetails: buildCardDetails(seed),
  };
}
