// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type OsspreyStatus = 'unassigned' | 'open' | 'assessing' | 'active' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive';
export type OsspreyLifecycle = 'active' | 'stable' | 'declining' | 'abandoned';
export type OsspreyEcosystem = 'npm' | 'maven' | 'pypi' | 'go';
export type OsspreyHealthBand = 'healthy' | 'fair' | 'concerning' | 'critical';
export type OspreySeverity = 'critical' | 'high' | 'medium' | 'low';
export type OspreySortKey = 'risk' | 'impact' | 'health' | 'vulns' | 'name';

// ===== CDP Raw Types =====

export interface CdpOpenVulns {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface CdpStewardshipSummary {
  purl: string;
  name: string;
  ecosystem: string;
  lifecycle: string | null;
  health: number | null;
  impact: number | null;
  maintainerBusFactor: number | null;
  openVulns: CdpOpenVulns | null;
  stewardship: string;
  steward: null;
}

export interface CdpPackagesListResponse {
  page: number;
  pageSize: number;
  total: number;
  filters: Record<string, unknown>;
  sort: { by: string; dir: string };
  packages: CdpStewardshipSummary[];
}

export interface OsspreyPackagesResponse {
  packages: OsspreyPackage[];
  total?: number | null;
}

export interface OsspreyListParams {
  page?: number;
  pageSize?: number;
  ecosystem?: string;
  lifecycle?: string;
  busFactor1Only?: boolean;
  staleOnly?: boolean;
  unstewardedOnly?: boolean;
  sortBy?: 'name' | 'health' | 'impact' | 'openVulns';
  sortDir?: 'asc' | 'desc';
}

export interface OsspreyDashboardSortSpec {
  sortBy: OsspreyListParams['sortBy'];
  sortDir: OsspreyListParams['sortDir'];
}

export interface CdpAdvisory {
  osvId: string;
  severity: OspreySeverity;
  resolution: string | null;
}

export interface CdpPackageDetail {
  purl: string;
  name: string;
  ecosystem: string;
  general: {
    healthScore: {
      maintainerHealth: number | null;
      securitySupplyChain: number | null;
      developmentActivity: number | null;
      total: number | null;
    } | null;
    impact: {
      impactScore: number | null;
      downloadsLastMonth: number | null;
      dependentPackages: number | null;
      dependentRepos: number | null;
      transitiveReach: string | null;
    } | null;
    riskSignals: {
      lifecycle: string | null;
      maintainerBusFactor: number | null;
      lastRelease: string | null;
      hasSecurityFile: boolean | null;
      openSSFScorecard: number | null;
    } | null;
  } | null;
  assessment: Record<string, unknown>;
  security: {
    securityContacts: unknown | null;
    advisories: CdpAdvisory[];
    cvd: {
      isPvrEnabled: boolean | null;
      hasSecurityPolicyEnabled: boolean | null;
      tier0Steward: unknown | null;
      criticalVulnerabilityFlag: boolean;
    } | null;
  } | null;
  provenance: {
    repositoryMapping: {
      declaredRepo: string | null;
      mappingConfidence: number | null;
      lastCommitAt: string | null;
    } | null;
    supplyChainIntegrity: {
      buildProvenance: unknown | null;
      signedReleases: unknown | null;
    } | null;
  } | null;
  history: Record<string, unknown>;
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

export interface OsspreyFilterChip {
  label: string;
  clear: Partial<OsspreyFilterState>;
}
