// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type OsspreyStatus = 'unassigned' | 'open' | 'assessing' | 'active' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive';
export type OsspreyLifecycle = 'active' | 'stable' | 'declining' | 'abandoned';
export type OsspreyEcosystem = 'npm' | 'maven' | 'pypi' | 'go' | 'cargo';
export type OsspreyHealthBand = 'healthy' | 'fair' | 'concerning' | 'critical';
export type OspreySeverity = 'critical' | 'high' | 'medium' | 'low';
export type OspreySortKey = 'risk' | 'impact' | 'health' | 'vulns' | 'name';

// ===== Steward admin action types =====

/** Steward assignment role (CDP: stewardship_stewards.role). */
export type OsspreyStewardRole = 'lead' | 'co_steward';

/** Statuses an admin can set directly via the status endpoint (excludes open/escalated, which have dedicated endpoints). */
export type OsspreyUpdatableStatus = 'assessing' | 'active' | 'needs_attention' | 'blocked' | 'inactive';

/** Reason captured when a stewardship is moved to `inactive` (required by the status endpoint). */
export type OsspreyInactiveReason = 'quarterly_cadence_missed' | 'stepped_down' | 'no_longer_critical';

/** Resolution path chosen when escalating a stewardship. */
export type OsspreyEscalationPath =
  | 'right_of_first_refusal'
  | 'replace_the_dependency'
  | 'find_vendor_for_lts'
  | 'consortium_adopts_maintainership'
  | 'compensating_controls_monitor'
  | 'namespace_takeover';

// ===== CDP Raw Types =====

export interface CdpStewardshipSummary {
  purl: string;
  name: string;
  ecosystem: string;
  lifecycle: string | null;
  health: number | null;
  impact: number | null;
  maintainerBusFactor: number | null;
  openVulns: number | null;
  stewardship: string;
  stewards: null;
}

export interface CdpPackagesListResponse {
  page: number;
  pageSize: number;
  total: number;
  statusCounts?: OsspreyStatusCounts;
  filters: Record<string, unknown>;
  sort: { by: string; dir: string };
  packages: CdpStewardshipSummary[];
}

export interface OsspreyPackagesResponse {
  packages: OsspreyPackage[];
  total?: number | null;
  statusCounts?: OsspreyStatusCounts;
}

export interface OsspreyListParams {
  page?: number;
  pageSize?: number;
  ecosystem?: string;
  lifecycle?: string;
  status?: OsspreyStatus | 'all';
  healthBand?: OsspreyHealthBand;
  vulnFilter?: 'critical' | 'high' | 'any';
  busFactor1Only?: boolean;
  staleOnly?: boolean;
  unstewardedOnly?: boolean;
  sortBy?: OspreySortKey;
  search?: string;
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
  stewardship: CdpStewardshipDetail | null;
  history: Record<string, unknown>;
}

// ===== CDP Stewardship Raw Types =====

/** Steward row as returned in the package detail `stewardship.stewards` array. No display name/avatar yet (see roster endpoint). */
export interface CdpStewardSummary {
  id: string;
  stewardshipId: string;
  userId: string;
  role: OsspreyStewardRole;
  assignedAt: string;
  assignedBy: string | null;
}

/** Stewardship block embedded in the CDP package detail response. */
export interface CdpStewardshipDetail {
  id: number | null;
  status: OsspreyStatus;
  stewards: CdpStewardSummary[] | null;
  lastActivityAt: string | null;
}

/** Full stewardship record returned by the mutation endpoints. */
export interface CdpStewardshipRecord {
  id: string;
  packageId: string;
  status: OsspreyStatus;
  origin: string;
  version: number;
  openedAt: string | null;
  lastStatusAt: string | null;
  inactiveReason: OsspreyInactiveReason | null;
  createdAt: string;
  updatedAt: string;
}

// ===== Steward admin action request/response bodies =====

export interface OsspreyOpenStewardshipRequest {
  purl: string;
}

export interface OsspreyAssignStewardRequest {
  userId: string;
  role: OsspreyStewardRole;
  /** When true, transitions an `unassigned`/`open` stewardship to `assessing` in the same call. */
  moveToAssessing?: boolean;
}

export interface OsspreyEscalateRequest {
  resolutionPath: OsspreyEscalationPath;
  notes?: string;
}

export interface OsspreyUpdateStatusRequest {
  status: OsspreyUpdatableStatus;
  /** Required when `status` is `inactive`. */
  inactiveReason?: OsspreyInactiveReason;
  notes?: string;
}

export interface OsspreyStewardshipResponse {
  stewardship: CdpStewardshipRecord;
}

export interface OsspreyAssignStewardResponse {
  stewardship: CdpStewardshipRecord;
  stewards: CdpStewardSummary[];
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

/**
 * Steward shown in the UI. `name`/`avatarUrl` are populated once the assignable-steward
 * roster endpoint exists; until then only `userId` (Auth0 sub) + `role` are available.
 */
export interface OsspreySteward {
  userId: string;
  role: OsspreyStewardRole;
  assignedAt: string;
  name: string | null;
  avatarUrl: string | null;
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
  /** Integer stewardship id from the detail endpoint — required to call the mutation endpoints. Null until a stewardship row exists. */
  stewardshipId: number | null;
  stewards: OsspreySteward[];
  lastActivityLabel: string;
  lastActivityTime: string;
  downloadsLastMonth: string | null;
  dependentPackages: string | null;
  dependentRepos: string | null;
  scoreCardScore: string | null;
  lastRelease: string | null;
  lastCommit: string | null;
  repoUrl: string | null;
  mappingConfidence: number | null;
  supplyChainMapping: 'High' | 'Medium' | 'Low' | null;
  provenance: 'Full' | 'Partial' | 'None' | null;
  pvrEnabled: boolean | null;
  criticalVulnFlag: boolean | null;
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

export interface OsspreyLoadResult {
  packages: OsspreyPackage[];
  total: number | null;
  error: boolean;
  statusCounts: OsspreyStatusCounts | null;
}

export interface CdpPackagesMetricsResponse {
  totalPackages: number;
  criticalPackages: number;
}

export interface OsspreyMetrics {
  totalPackages: number;
  criticalPackages: number;
}
