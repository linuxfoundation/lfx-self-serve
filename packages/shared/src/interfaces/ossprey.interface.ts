// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type OsspreyStatus = 'unassigned' | 'open' | 'assessing' | 'active' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive';
export type OsspreyLifecycle = 'active' | 'stable' | 'declining' | 'abandoned';
export type OsspreyEcosystem = 'npm' | 'maven' | 'pypi' | 'go';
export type OsspreyHealthBand = 'healthy' | 'fair' | 'concerning' | 'critical';
export type OspreySeverity = 'critical' | 'high' | 'medium' | 'low';
export type OspreySortKey = 'risk' | 'impact' | 'health' | 'vulns' | 'name';

// ===== CDP Raw Types =====

export interface CdpSteward {
  userId: string;
  name: string;
  role: 'lead' | 'co_steward';
  assignedAt: string;
}

export interface CdpOpenVulns {
  count: number;
  severity?: OspreySeverity | null;
}

export interface CdpStewardshipSummary {
  purl?: string | null;
  name: string;
  ecosystem: string;
  lifecycle?: string | null;
  health?: number | null;
  impact?: number | null;
  openVulns?: CdpOpenVulns | null;
  status: OsspreyStatus;
  origin: string;
  stewards: CdpSteward[];
  lastActivityAt?: string | null;
  lastActivityDescription?: string | null;
}

export interface CdpBatchStewardshipResponse {
  packages: Record<string, CdpStewardshipSummary | null>;
}

export interface CdpPackagesListResponse {
  packages: CdpStewardshipSummary[];
  nextCursor?: string | null;
  total?: number | null;
}

export interface OsspreyPackagesResponse {
  packages: OsspreyPackage[];
  nextCursor?: string | null;
  total?: number | null;
}

export interface OsspreyListParams {
  sort?: string;
  status?: string;
  ecosystem?: string;
  lifecycle?: string;
  healthBand?: string;
  vulnFilter?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface CdpAdvisory {
  id: string;
  severity: OspreySeverity;
  summary?: string | null;
  status: 'open' | 'patched';
  cvss?: number | null;
  publishedAt?: string | null;
  affectedVersionRange?: {
    introduced?: string | null;
    fixed?: string | null;
    lastAffected?: string | null;
  } | null;
}

export interface CdpScorecardCheck {
  name: string;
  score: number;
}

export interface CdpMaintainer {
  name: string;
  email?: string;
  verified: boolean;
}

export interface CdpProvenanceMapping {
  ecosystem: string;
  confidence: number;
  verified: boolean;
}

export interface CdpRepository {
  url?: string;
  lastCommitAt?: string | null;
  scorecardScore?: number | null;
}

export interface CdpHealthBreakdown {
  maintainerHealth?: number | null;
  securityAndSupplyChain?: number | null;
  developmentActivity?: number | null;
}

export interface CdpStewardshipActivity {
  activityType: string;
  content?: string;
  createdAt: string;
}

export interface CdpStewardshipFinding {
  id: string;
  severity: OspreySeverity;
  description: string;
}

export interface CdpRemediationAction {
  id: string;
  title: string;
  status: string;
  completedAt?: string | null;
}

export interface CdpStewardshipAssessment {
  posture?: string;
  reviewed: boolean;
  flagged: boolean;
  flagNote?: string;
}

export interface CdpStewardshipDetail {
  status: OsspreyStatus;
  stewards: CdpSteward[];
  activity: CdpStewardshipActivity[];
  lastActivityAt?: string | null;
  lastActivityDescription?: string | null;
  assessment?: CdpStewardshipAssessment;
}

export interface CdpPackageDetail {
  purl: string;
  name: string;
  ecosystem: string;
  lifecycle?: string | null;
  repository?: CdpRepository;
  healthBreakdown?: CdpHealthBreakdown;
  advisories: CdpAdvisory[];
  provenanceMappings: CdpProvenanceMapping[];
  stewardship: CdpStewardshipDetail;
  dependentPackagesCount?: number | null;
  dependentReposCount?: number | null;
  downloads?: number | null;
  latestReleaseAt?: string | null;
  disclosureReadiness: {
    securityMdPresent: boolean;
  };
  transitiveReach?: string | null;
}

// ===== Frontend Types =====

export interface OsspreyAdvisory {
  id: string;
  severity: OspreySeverity;
  description: string;
  state: 'Open' | 'Patched';
  cvss?: number | null;
  publishedAt?: string | null;
  affectedVersionRange?: {
    introduced?: string | null;
    fixed?: string | null;
    lastAffected?: string | null;
  } | null;
}

export interface OsspreyHistoryEntry {
  label: string;
  timeAgo: string;
  type?: 'danger' | 'success';
}

export interface OsspreyAssessment {
  posture: string;
  reviewed: boolean;
  flagged: boolean;
  flagNote?: string;
  draft?: boolean;
  findings: Array<[string, OspreySeverity | 'low', string]>;
  remediation: string[];
  monitoring: string[];
}

export interface OsspreyContactGroup {
  name: string;
  type: string;
  count: number;
  coverage: number;
  packages: string[];
  hasPvr: boolean;
  hasSecurityMd: boolean;
}

export interface OsspreyPackage {
  id: string;
  name: string;
  purl: string;
  ecosystem: OsspreyEcosystem;
  lifecycle: OsspreyLifecycle | null;
  healthScore: number | null;
  impactScore: number | null;
  busFactor: number | null;
  monthsStale: number | null;
  vulnCount: number;
  vulnSeverity: OspreySeverity | null;
  status: OsspreyStatus;
  stewardIds: string[];
  lastActivityLabel: string;
  lastActivityTime: string;
  weeklyDownloads: string | null;
  dependentCount: string | null;
  directDependentCount: string | null;
  scoreCardScore: string | null;
  lastRelease: string | null;
  lastCommit: string | null;
  repoUrl: string | null;
  supplyChainMapping: 'High' | 'Medium' | 'Low' | null;
  provenance: 'Full' | 'Partial' | 'None' | null;
  hasSecurityMd: boolean | null;
  ecosystemReach: string | null;
  contactGroup: OsspreyContactGroup | null;
  healthBreakdown: string[];
  assessment: OsspreyAssessment | null;
  advisories: OsspreyAdvisory[];
  history: OsspreyHistoryEntry[];
}

export interface OsspreyFilterState {
  search: string;
  tab: OsspreyStatus | 'all';
  sort: OspreySortKey;
  ecosystem: OsspreyEcosystem | '';
  lifecycle: OsspreyLifecycle | '';
  healthBand: OsspreyHealthBand | '';
  vulnFilter: 'critical' | 'high' | 'any' | '';
  busFactor1Only: boolean;
  staleOnly: boolean;
  unstewardedOnly: boolean;
}

export interface OsspreyStatusCounts {
  all: number;
  unassigned: number;
  open: number;
  assessing: number;
  active: number;
  needs_attention: number;
  escalated: number;
  blocked: number;
  inactive: number;
}
