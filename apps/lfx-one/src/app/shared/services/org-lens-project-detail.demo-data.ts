// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type {
  OrgLensProjectDetailResponse,
  OrgLensProjectEcosystemCard,
  OrgLensProjectHealth,
  OrgLensProjectLeaderboardRow,
  OrgLensProjectTechnicalCard,
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

function pctOf(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 1000;
}

function technicalCards(seed: ProjectDetailSeed): OrgLensProjectTechnicalCard[] {
  return [
    {
      key: 'maintainers',
      label: 'Maintainers',
      orgCount: seed.org.maintainers,
      projectTotal: seed.totals.maintainers,
      pct: pctOf(seed.org.maintainers, seed.totals.maintainers),
      sparkline: ramp(seed.org.maintainers, 0.6),
    },
    {
      key: 'contributors',
      label: 'Contributors',
      orgCount: seed.org.contributors,
      projectTotal: seed.totals.contributors,
      pct: pctOf(seed.org.contributors, seed.totals.contributors),
      sparkline: ramp(seed.org.contributors, 0.55),
    },
    {
      key: 'commits',
      label: 'Commit Activities',
      orgCount: seed.org.commits,
      projectTotal: seed.totals.commits,
      pct: pctOf(seed.org.commits, seed.totals.commits),
      sparkline: ramp(seed.org.commits, 0.65),
    },
    {
      key: 'pull-requests',
      label: 'Pull Requests',
      orgCount: seed.org.prs,
      projectTotal: seed.totals.prs,
      pct: pctOf(seed.org.prs, seed.totals.prs),
      sparkline: ramp(seed.org.prs, 0.65),
    },
  ];
}

function ecosystemCards(seed: ProjectDetailSeed): OrgLensProjectEcosystemCard[] {
  const collab = seed.ecosystem.collaboration;
  const committee = seed.ecosystem.committeeMembers;
  return [
    // Collaboration shows a "% of all" (denominator picked so Kubernetes lands at the prototype's 9.6%).
    {
      key: 'collaboration',
      label: 'Collaboration Activity',
      count: collab,
      pct: collab === 0 ? 0 : Math.round((collab / 15333) * 1000) / 1000,
      sparkline: ramp(collab, 0.6),
    },
    // Meeting attendance is a raw count; 0 → no trendline ("No data").
    {
      key: 'meeting-attendance',
      label: 'Meeting Attendance',
      count: seed.ecosystem.meetingAttendance,
      pct: 0,
      sparkline: seed.ecosystem.meetingAttendance === 0 ? [] : ramp(seed.ecosystem.meetingAttendance, 0.6),
    },
    {
      key: 'board-members',
      label: 'Board Members',
      count: seed.ecosystem.boardMembers,
      pct: 0,
      sparkline: seed.ecosystem.boardMembers === 0 ? [] : ramp(seed.ecosystem.boardMembers, 0.6),
    },
    // Committee members shows a "% of all" (denominator picked so Kubernetes lands at the prototype's 1.1%).
    {
      key: 'committee-members',
      label: 'Committee Members',
      count: committee,
      pct: committee === 0 ? 0 : Math.round((committee / 364) * 1000) / 1000,
      sparkline: committee === 0 ? [] : ramp(committee, 0.6),
    },
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
      logoUrl: '',
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
    ecosystem: ecosystemCards(seed),
    trend: trendSeries(seed),
    leaderboard: leaderboard(seed, orgName),
  };
}
