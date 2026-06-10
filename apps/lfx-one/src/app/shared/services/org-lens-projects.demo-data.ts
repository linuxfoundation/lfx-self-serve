// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type {
  InfluenceTrend,
  InfluenceTrendDirection,
  OrgLensProject,
  OrgLensProjectFoundation,
  OrgLensProjectPerson,
  OrgLensProjectsResponse,
  ProjectHealthMetric,
} from '@lfx-one/shared/interfaces';

/**
 * Demo company data for the Org Lens Projects page (LFXV2-1883 / LFXV2-1884).
 *
 * Real company-data integration (Snowflake / LFX Insights) is a separate story; until
 * then `OrgLensProjectsService` serves these fixtures. They are deliberately varied to
 * exercise every band / health / trend state and the Influence Summary empty cases:
 * one project has `priorYearScore: 0` (excluded from Most Gains) and one is archived
 * with `influenceScore: 0` (excluded from Most Decreases).
 */

// Person avatar URLs are intentionally empty (initials fallback). Project logos are populated separately from GitHub avatar URLs.
function person(id: string, name: string): OrgLensProjectPerson {
  return { id, name, avatarUrl: '' };
}

const CNCF: OrgLensProjectFoundation = { slug: 'cncf', name: 'CNCF', logoUrl: '' };
const LF_AI: OrgLensProjectFoundation = { slug: 'lf-ai-data', name: 'LF AI & Data', logoUrl: '' };
const LF_NETWORKING: OrgLensProjectFoundation = { slug: 'lf-networking', name: 'LF Networking', logoUrl: '' };
const OPENSSF: OrgLensProjectFoundation = { slug: 'openssf', name: 'OpenSSF', logoUrl: '' };
const CD_FOUNDATION: OrgLensProjectFoundation = { slug: 'cd-foundation', name: 'CD Foundation', logoUrl: '' };

function trendDirection(deltaPct: number): InfluenceTrendDirection {
  if (deltaPct > 1) {
    return 'up';
  }
  return deltaPct < -1 ? 'down' : 'flat';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Demo technical/ecosystem deltas are deterministic variations of the combined delta so the
// hover tooltip shows three distinct-but-plausible numbers. Real data supplies all three directly.
function trend(deltaPct: number, series: number[]): InfluenceTrend {
  return {
    deltaPct,
    technicalDeltaPct: round1(deltaPct * 1.15),
    ecosystemDeltaPct: round1(deltaPct * 0.8),
    direction: trendDirection(deltaPct),
    series,
  };
}

// `description` + `healthMetrics` are injected by getDemoProjectsResponse so the 14 base rows stay terse.
const DEMO_PROJECTS: Omit<OrgLensProject, 'description' | 'healthMetrics'>[] = [
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    logoUrl: '',
    foundation: CNCF,
    health: 'excellent',
    technicalInfluence: 'leading',
    ecosystemInfluence: 'leading',
    influenceScore: 92.4,
    priorYearScore: 78.2,
    trend: trend(18.2, [78, 80, 83, 85, 88, 90, 92]),
    maintainers: [
      person('p1', 'Ada Lovelace'),
      person('p2', 'Grace Hopper'),
      person('p3', 'Alan Turing'),
      person('p4', 'Linus Park'),
      person('p5', 'Mira Chen'),
    ],
    contributors: [
      person('p6', 'Tom Reyes'),
      person('p7', 'Nina Patel'),
      person('p8', 'Omar Diaz'),
      person('p9', 'Sara Kim'),
      person('p10', 'Wei Zhang'),
      person('p11', 'Eve Stone'),
    ],
    participants: [person('p12', 'Raj Singh'), person('p13', 'Lena Fox')],
    commits1y: 48210,
    changeDriver: { label: '+3 maintainers', direction: 'up' },
  },
  {
    slug: 'prometheus',
    name: 'Prometheus',
    logoUrl: '',
    foundation: CNCF,
    health: 'excellent',
    technicalInfluence: 'leading',
    ecosystemInfluence: 'contributing',
    influenceScore: 84.1,
    priorYearScore: 76.5,
    trend: trend(9.9, [76, 77, 79, 80, 82, 83, 84]),
    maintainers: [person('p14', 'Carlos Mota'), person('p15', 'Yuki Tanaka')],
    contributors: [person('p16', 'Dana Cole'), person('p17', 'Ivan Petrov'), person('p18', 'Maya Rao')],
    participants: [person('p19', 'Joel Park')],
    commits1y: 12880,
    changeDriver: { label: '+38% commits', direction: 'up' },
  },
  {
    slug: 'envoy',
    name: 'Envoy',
    logoUrl: '',
    foundation: CNCF,
    health: 'healthy',
    technicalInfluence: 'leading',
    ecosystemInfluence: 'contributing',
    influenceScore: 80.7,
    priorYearScore: 71.0,
    trend: trend(13.7, [71, 72, 74, 76, 78, 79, 81]),
    maintainers: [person('p20', 'Priya Nair'), person('p21', 'Hugo Blanc'), person('p22', 'Sven Olsen')],
    contributors: [person('p23', 'Lily Brooks'), person('p24', 'Kofi Mensah')],
    participants: [person('p25', 'Anya Volkov'), person('p26', 'Diego Ruiz'), person('p27', 'Fatima Zahra')],
    commits1y: 9340,
    changeDriver: { label: '+2 board seats', direction: 'up' },
  },
  {
    slug: 'opentelemetry',
    name: 'OpenTelemetry',
    logoUrl: '',
    foundation: CNCF,
    health: 'excellent',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'leading',
    influenceScore: 79.3,
    priorYearScore: 58.9,
    trend: trend(34.6, [58, 62, 66, 70, 74, 77, 79]),
    maintainers: [person('p28', 'Reza Karimi'), person('p29', 'Bo Andersson')],
    contributors: [person('p30', 'Tara Singh'), person('p31', 'Max Weber'), person('p32', 'Iris Lin'), person('p33', 'Pavel Novak')],
    participants: [person('p34', 'Noor Ali')],
    commits1y: 15600,
    changeDriver: { label: '+52% commits', direction: 'up' },
  },
  {
    slug: 'argo',
    name: 'Argo',
    logoUrl: '',
    foundation: CNCF,
    health: 'healthy',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'contributing',
    influenceScore: 68.5,
    priorYearScore: 64.2,
    trend: trend(6.7, [64, 65, 65, 66, 67, 68, 69]),
    maintainers: [person('p35', 'Greta Hahn')],
    contributors: [person('p36', 'Sam Otieno'), person('p37', 'Bianca Russo')],
    participants: [person('p38', 'Kenji Mori'), person('p39', 'Aisha Bello')],
    commits1y: 6120,
    changeDriver: { label: '+1 maintainer', direction: 'up' },
  },
  {
    slug: 'pytorch',
    name: 'PyTorch',
    logoUrl: '',
    foundation: LF_AI,
    health: 'excellent',
    technicalInfluence: 'leading',
    ecosystemInfluence: 'leading',
    influenceScore: 88.0,
    priorYearScore: 83.4,
    trend: trend(5.5, [83, 84, 85, 86, 86, 87, 88]),
    maintainers: [person('p40', 'Hannah Frost'), person('p41', 'Leo Marsh'), person('p42', 'Devi Suresh')],
    contributors: [person('p43', 'Quinn Hale'), person('p44', 'Ravi Iyer'), person('p45', 'Selin Aydin'), person('p46', 'Tobias Weiss')],
    participants: [person('p47', 'Mei Lin')],
    commits1y: 21030,
    changeDriver: { label: '+24% commits', direction: 'up' },
  },
  {
    slug: 'onnx',
    name: 'ONNX',
    logoUrl: '',
    foundation: LF_AI,
    health: 'healthy',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'participating',
    influenceScore: 54.2,
    priorYearScore: 57.8,
    trend: trend(-6.2, [58, 57, 57, 56, 55, 55, 54]),
    maintainers: [person('p48', 'Owen Clarke')],
    contributors: [person('p49', 'Petra Vogel'), person('p50', 'Hassan Najjar')],
    participants: [person('p51', 'Rita Costa')],
    commits1y: 3420,
    changeDriver: { label: '-22% commits', direction: 'down' },
  },
  {
    slug: 'onap',
    name: 'ONAP',
    logoUrl: '',
    foundation: LF_NETWORKING,
    health: 'at-risk',
    technicalInfluence: 'participating',
    ecosystemInfluence: 'participating',
    influenceScore: 41.6,
    priorYearScore: 51.4,
    trend: trend(-19.1, [51, 49, 48, 46, 44, 43, 42]),
    maintainers: [person('p52', 'Gabe Lewis')],
    contributors: [person('p53', 'Hana Suzuki')],
    participants: [person('p54', 'Igor Pavlov'), person('p55', 'Joy Adeyemi')],
    commits1y: 1880,
    changeDriver: { label: '-1 maintainer', direction: 'down' },
  },
  {
    slug: 'fd-io',
    name: 'FD.io',
    logoUrl: '',
    foundation: LF_NETWORKING,
    health: 'at-risk',
    technicalInfluence: 'silent',
    ecosystemInfluence: 'non-lf',
    influenceScore: 33.9,
    priorYearScore: 42.7,
    trend: trend(-20.6, [43, 41, 40, 38, 36, 35, 34]),
    maintainers: [],
    contributors: [person('p56', 'Karl Schmidt')],
    participants: [person('p57', 'Lucia Moreno')],
    commits1y: 940,
    changeDriver: { label: '-31% commits', direction: 'down' },
  },
  {
    slug: 'sigstore',
    name: 'Sigstore',
    logoUrl: '',
    foundation: OPENSSF,
    health: 'healthy',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'contributing',
    influenceScore: 62.8,
    // No 12-month baseline (graduated mid-window) — excluded from Most Gains.
    priorYearScore: 0,
    trend: trend(0, [60, 61, 62, 62, 62, 63, 63]),
    maintainers: [person('p58', 'Nadia Haddad'), person('p59', 'Oskar Lind')],
    contributors: [person('p60', 'Pia Berg'), person('p61', 'Rohan Mehta')],
    participants: [],
    commits1y: 4510,
    changeDriver: { label: 'New baseline', direction: 'flat' },
  },
  {
    slug: 'in-toto',
    name: 'in-toto',
    logoUrl: '',
    foundation: OPENSSF,
    health: 'healthy',
    technicalInfluence: 'participating',
    ecosystemInfluence: 'silent',
    influenceScore: 47.3,
    priorYearScore: 44.9,
    trend: trend(5.3, [44, 45, 45, 46, 46, 47, 47]),
    maintainers: [person('p62', 'Sami Rahimi')],
    contributors: [person('p63', 'Tess Howell')],
    participants: [person('p64', 'Umar Faruk'), person('p65', 'Vera Klein'), person('p66', 'Will Tanaka')],
    commits1y: 2210,
    changeDriver: { label: '+12% commits', direction: 'up' },
  },
  {
    slug: 'tekton',
    name: 'Tekton',
    logoUrl: '',
    foundation: CD_FOUNDATION,
    health: 'healthy',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'participating',
    influenceScore: 58.1,
    priorYearScore: 60.9,
    trend: trend(-4.6, [61, 60, 60, 59, 59, 58, 58]),
    maintainers: [person('p67', 'Xena Pope')],
    contributors: [person('p68', 'Yusuf Demir'), person('p69', 'Zoe Walsh')],
    participants: [person('p70', 'Arman Yilmaz')],
    commits1y: 3990,
    changeDriver: { label: '-1 board seat', direction: 'down' },
  },
  {
    slug: 'jenkins',
    name: 'Jenkins',
    logoUrl: '',
    foundation: CD_FOUNDATION,
    health: 'at-risk',
    technicalInfluence: 'silent',
    ecosystemInfluence: 'non-lf',
    // Archived in our workspace — excluded from Most Decreases (current score 0).
    influenceScore: 0,
    priorYearScore: 38.2,
    trend: trend(-42.0, [38, 30, 24, 16, 9, 4, 0]),
    maintainers: [],
    contributors: [],
    participants: [person('p71', 'Bella North')],
    commits1y: 120,
    changeDriver: { label: 'Archived', direction: 'down' },
  },
  {
    slug: 'spiffe-spire',
    name: 'SPIFFE / SPIRE',
    logoUrl: '',
    foundation: CNCF,
    health: 'healthy',
    technicalInfluence: 'contributing',
    ecosystemInfluence: 'contributing',
    influenceScore: 66.0,
    priorYearScore: 55.1,
    trend: trend(19.8, [55, 57, 59, 61, 63, 65, 66]),
    maintainers: [person('p72', 'Cody Frank'), person('p73', 'Dilara Kaya')],
    contributors: [person('p74', 'Emil Larsson'), person('p75', 'Farah Saleh'), person('p76', 'Gus Romero')],
    participants: [person('p77', 'Hye-jin Park'), person('p78', 'Ido Cohen')],
    commits1y: 5230,
    changeDriver: { label: '+2 maintainers', direction: 'up' },
  },
];

// Demo project logos sourced from each project's public GitHub org avatar (CDN-served, stable).
const LOGO_BY_SLUG: Record<string, string> = {
  kubernetes: 'https://github.com/kubernetes.png?size=80',
  prometheus: 'https://github.com/prometheus.png?size=80',
  envoy: 'https://github.com/envoyproxy.png?size=80',
  opentelemetry: 'https://github.com/open-telemetry.png?size=80',
  argo: 'https://github.com/argoproj.png?size=80',
  pytorch: 'https://github.com/pytorch.png?size=80',
  onnx: 'https://github.com/onnx.png?size=80',
  onap: 'https://github.com/onap.png?size=80',
  'fd-io': 'https://github.com/FDio.png?size=80',
  sigstore: 'https://github.com/sigstore.png?size=80',
  'in-toto': 'https://github.com/in-toto.png?size=80',
  tekton: 'https://github.com/tektoncd.png?size=80',
  jenkins: 'https://github.com/jenkinsci.png?size=80',
  'spiffe-spire': 'https://github.com/spiffe.png?size=80',
};

// Short descriptions shown in the health-detail popover (generic fallback covers any unmapped slug).
const DESCRIPTION_BY_SLUG: Record<string, string> = {
  kubernetes: 'Production-grade container orchestration for automating deployment, scaling, and management of containerized applications.',
  prometheus: 'An open-source systems monitoring and alerting toolkit with a dimensional data model and a powerful query language.',
  envoy: 'A high-performance open source edge and service proxy designed for cloud-native applications.',
  opentelemetry: 'A collection of APIs, SDKs, and tools for instrumenting, generating, and collecting telemetry data.',
  argo: 'Kubernetes-native workflow engine and GitOps continuous delivery tooling.',
  pytorch: 'An open source machine learning framework that accelerates the path from research prototyping to production.',
  onnx: 'An open standard for representing machine learning models, enabling interoperability across frameworks.',
  onap: 'Open Network Automation Platform for orchestrating physical and virtual network functions.',
  'fd-io': 'Fast Data I/O: a high-performance IO services framework for dynamic networking workloads.',
  sigstore: 'Free software signing and transparency to make the software supply chain more secure.',
  'in-toto': 'A framework to cryptographically secure the integrity of software supply chains.',
  tekton: 'A flexible Kubernetes-native framework for building CI/CD systems.',
  jenkins: 'The leading open source automation server for building, testing, and deploying software.',
  'spiffe-spire': 'A universal identity control plane that issues cryptographic workload identities to distributed systems.',
};

// Deterministic CHAOSS-style sub-scores so the health popover is stable across reloads. Real data supplies these.
function buildHealthMetrics(project: Omit<OrgLensProject, 'description' | 'healthMetrics'>): ProjectHealthMetric[] {
  const baseByHealth: Record<string, number> = { excellent: 84, healthy: 64, 'at-risk': 42 };
  const base = baseByHealth[project.health] ?? 60;
  const seed = project.slug.length + Math.round(project.influenceScore);
  const score = (offset: number): number => Math.max(22, Math.min(98, base + ((seed * (offset + 3)) % 26) - 10));
  return [
    { label: 'Contributors', value: score(1) },
    { label: 'Popularity', value: score(2) },
    { label: 'Development', value: score(3) },
    { label: 'Security', value: score(4) },
  ];
}

/** Demo response for a single org. The org slug/name flow into the CSV export filename + header. */
export function getDemoProjectsResponse(orgUid: string, orgName: string): OrgLensProjectsResponse {
  // Sanitize first, then fall back to orgUid — covers names that sanitize to an empty slug (e.g. punctuation-only).
  const orgSlug =
    orgName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || orgUid;
  return {
    orgSlug,
    orgName: orgName || 'Your organization',
    // Static demo build timestamp (~2h ago).
    dataUpdatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    projects: DEMO_PROJECTS.map((project) => ({
      ...project,
      logoUrl: LOGO_BY_SLUG[project.slug] ?? project.logoUrl,
      description: DESCRIPTION_BY_SLUG[project.slug] ?? `${project.name} is an open source project in the ${project.foundation.name} ecosystem.`,
      healthMetrics: buildHealthMetrics(project),
    })),
  };
}
