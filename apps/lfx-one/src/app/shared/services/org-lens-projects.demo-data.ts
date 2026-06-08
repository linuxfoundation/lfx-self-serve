// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { InfluenceTrendDirection, OrgLensProject, OrgLensProjectFoundation, OrgLensProjectPerson, OrgLensProjectsResponse } from '@lfx-one/shared/interfaces';

/**
 * Demo company data for the Org Lens Projects page (LFXV2-1883 / LFXV2-1884).
 *
 * Real company-data integration (Snowflake / LFX Insights) is a separate story; until
 * then `OrgLensProjectsService` serves these fixtures. They are deliberately varied to
 * exercise every band / health / trend state and the Influence Summary empty cases:
 * one project has `priorYearScore: 0` (excluded from Most Gains) and one is archived
 * with `influenceScore: 0` (excluded from Most Decreases).
 */

// Empty avatar / logo URLs fall back to initials in the avatar/logo components — no network needed for demo.
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

function trend(deltaPct: number, series: number[]): { deltaPct: number; direction: InfluenceTrendDirection; series: number[] } {
  return { deltaPct, direction: trendDirection(deltaPct), series };
}

const DEMO_PROJECTS: OrgLensProject[] = [
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
    maintainers: [person('p1', 'Ada Lovelace'), person('p2', 'Grace Hopper'), person('p3', 'Alan Turing'), person('p4', 'Linus Park'), person('p5', 'Mira Chen')],
    contributors: [person('p6', 'Tom Reyes'), person('p7', 'Nina Patel'), person('p8', 'Omar Diaz'), person('p9', 'Sara Kim'), person('p10', 'Wei Zhang'), person('p11', 'Eve Stone')],
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
    technicalInfluence: 'participating',
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
    ecosystemInfluence: 'participating',
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
    technicalInfluence: 'participating',
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

/** Demo response for a single org. The org slug/name flow into the CSV export filename + header. */
export function getDemoProjectsResponse(orgUid: string, orgName: string): OrgLensProjectsResponse {
  return {
    orgSlug: orgName ? orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : orgUid,
    orgName: orgName || 'Your organization',
    // Static demo build timestamp (~2h ago) so the freshness label renders a stable relative value.
    dataUpdatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    projects: DEMO_PROJECTS.map((project) => ({ ...project })),
  };
}
