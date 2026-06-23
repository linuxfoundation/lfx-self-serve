// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type AkritesStatus = 'unassigned' | 'open' | 'assessing' | 'active' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive';
export type AkritesLifecycle = 'active' | 'stable' | 'declining' | 'abandoned';
export type AkritesEcosystem = 'npm' | 'maven' | 'pypi' | 'go' | 'cargo';
export type AkritesHealthBand = 'healthy' | 'fair' | 'concerning' | 'critical';
export type AkritesSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AkritesSortKey = 'risk' | 'impact' | 'health' | 'vulns' | 'name';

// ===== Steward admin action types =====

/** Steward assignment role (CDP: stewardship_stewards.role). */
export type AkritesStewardRole = 'lead' | 'co_steward';

/** Statuses an admin can set directly via the status endpoint (excludes open/escalated, which have dedicated endpoints). */
export type AkritesUpdatableStatus = 'assessing' | 'active' | 'needs_attention' | 'blocked' | 'inactive';

/** Reason captured when a stewardship is moved to `inactive` (required by the status endpoint). */
export type AkritesInactiveReason = 'quarterly_cadence_missed' | 'stepped_down' | 'no_longer_critical';

/** Resolution path chosen when escalating a stewardship. */
export type AkritesEscalationPath =
  | 'right_of_first_refusal'
  | 'replace_the_dependency'
  | 'find_vendor_for_lts'
  | 'consortium_adopts_maintainership'
  | 'compensating_controls_monitor'
  | 'namespace_takeover';

/** Role option displayed in the assign-steward modal picker. */
export interface AkritesRoleOption {
  value: AkritesStewardRole;
  label: string;
  description: string;
}

/** A committee member returned by the steward search endpoint, used for the assignable-steward picker. */
export interface AkritesSearchStewardResult {
  /** Auth0/LFX user UID — sent as `userId` in the assign endpoint body. */
  userId: string;
  username: string;
  displayName: string;
  organization: string | null;
  status: string;
  /** Pre-computed initials for the avatar display — avoids method calls in templates. */
  initials: string;
}

// ===== CDP Raw Types =====

export interface CdpActivityActor {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface CdpActivityRow {
  id: string;
  stewardshipId: string;
  packagePurl: string;
  actor: CdpActivityActor | null;
  actorType: string;
  activityType: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  stewardshipStatus: string;
  createdAt: string;
}

export interface CdpActivityResponse {
  rows: CdpActivityRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CdpStewardshipSummary {
  purl: string;
  name: string;
  ecosystem: string;
  criticalityScore: string | null;
  stewardshipId: string | null;
  stewardshipStatus: string | null;
  openVulns: number | null;
  maxVulnSeverity: string | null;
  maintainerCount: number | null;
  scorecardScore: string | number | null;
  healthBand: string | null;
  latestReleaseAt: string | null;
  lastActivity: { type: string; content: string; at: string } | null;
  stewards: { userId: string; username: string | null; displayName: string | null; role: string; assignedAt: string }[];
}

export interface CdpPackagesListResponse {
  page: number;
  pageSize: number;
  total: number;
  statusCounts?: AkritesStatusCounts;
  filters: Record<string, unknown>;
  sort: { by: string; dir: string };
  rows: CdpStewardshipSummary[];
}

export interface AkritesPackagesResponse {
  packages: AkritesPackage[];
  total?: number | null;
  statusCounts?: AkritesStatusCounts;
}

export interface AkritesListParams {
  page?: number;
  pageSize?: number;
  ecosystem?: string;
  lifecycle?: string;
  status?: AkritesStatus | 'all';
  healthBand?: AkritesHealthBand;
  vulnFilter?: 'critical' | 'high' | 'any';
  busFactor1Only?: boolean;
  staleOnly?: boolean;
  unstewardedOnly?: boolean;
  sortBy?: AkritesSortKey;
  search?: string;
}

export interface CdpAdvisory {
  osvId: string;
  severity: AkritesSeverity;
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

/** Steward row as returned in the package detail `stewardship.stewards` array. */
export interface CdpStewardSummary {
  id: string;
  stewardshipId: string;
  userId: string;
  username: string | null;
  displayName: string | null;
  role: AkritesStewardRole;
  assignedAt: string;
  assignedBy: string | null;
}

/** Stewardship block embedded in the CDP package detail response. */
export interface CdpStewardshipDetail {
  id: number | null;
  status: AkritesStatus;
  stewards: CdpStewardSummary[] | null;
  lastActivityAt: string | null;
}

/** Full stewardship record returned by the mutation endpoints. */
export interface CdpStewardshipRecord {
  id: string;
  packageId: string;
  status: AkritesStatus;
  origin: string;
  version: number;
  openedAt: string | null;
  lastStatusAt: string | null;
  inactiveReason: AkritesInactiveReason | null;
  createdAt: string;
  updatedAt: string;
}

// ===== Steward admin action request/response bodies =====

export interface AkritesOpenStewardshipRequest {
  purl: string;
  actor: AkritesActorInput;
}

export interface AkritesActorInput {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface AkritesAssignStewardRequest {
  steward: {
    userId: string;
    username: string | null;
    displayName: string | null;
    role: AkritesStewardRole;
  };
  /** When true, transitions an `unassigned`/`open` stewardship to `assessing` in the same call. */
  moveToAssessing?: boolean;
}

export interface AkritesEscalateRequest {
  resolutionPath: AkritesEscalationPath;
  notes?: string;
}

export interface AkritesUpdateStatusRequest {
  status: AkritesUpdatableStatus;
  /** Required when `status` is `inactive`. */
  inactiveReason?: AkritesInactiveReason;
  notes?: string;
}

export interface AkritesStewardshipResponse {
  stewardship: CdpStewardshipRecord;
}

export interface AkritesAssignStewardResponse {
  stewardship: CdpStewardshipRecord;
  stewards: CdpStewardSummary[];
}

// ===== Frontend Types =====

export interface AkritesAdvisory {
  id: string;
  severity: AkritesSeverity;
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

export interface AkritesHistoryEntry {
  label: string;
  timeAgo: string;
  type?: 'danger' | 'success';
}

export interface AkritesAssessment {
  posture: string;
  reviewed: boolean;
  flagged: boolean;
  flagNote?: string;
  draft?: boolean;
  findings: Array<[string, AkritesSeverity | 'low', string]>;
  remediation: string[];
  monitoring: string[];
}

/** Steward shown in the UI. `name` is the display name from CDP; `username` is the LFX username. */
export interface AkritesSteward {
  userId: string;
  username: string | null;
  role: AkritesStewardRole;
  assignedAt: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AkritesContactGroup {
  name: string;
  type: string;
  count: number;
  coverage: number;
  packages: string[];
  hasPvr: boolean;
  hasSecurityMd: boolean;
}

export interface AkritesPackage {
  id: string;
  name: string;
  purl: string;
  ecosystem: AkritesEcosystem;
  lifecycle: AkritesLifecycle | null;
  healthScore: number | null;
  impactScore: number | null;
  busFactor: number | null;
  monthsStale: number | null;
  vulnCount: number;
  vulnSeverity: AkritesSeverity | null;
  status: AkritesStatus;
  /** Integer stewardship id from the detail endpoint — required to call the mutation endpoints. Null until a stewardship row exists. */
  stewardshipId: number | null;
  stewards: AkritesSteward[];
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
  contactGroup: AkritesContactGroup | null;
  healthBreakdown: string[];
  assessment: AkritesAssessment | null;
  advisories: AkritesAdvisory[];
  history: AkritesHistoryEntry[];
}

export interface AkritesFilterState {
  search: string;
  tab: AkritesStatus | 'all';
  sort: AkritesSortKey;
  ecosystem: AkritesEcosystem | '';
  lifecycle: AkritesLifecycle | '';
  healthBand: AkritesHealthBand | '';
  vulnFilter: 'critical' | 'high' | 'any' | '';
  busFactor1Only: boolean;
  staleOnly: boolean;
  unstewardedOnly: boolean;
  page: number;
  pageSize: number;
}

export interface AkritesStatusCounts {
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

export interface AkritesFilterChip {
  label: string;
  clear: Partial<AkritesFilterState>;
}

export interface AkritesLoadResult {
  packages: AkritesPackage[];
  total: number | null;
  error: boolean;
  statusCounts: AkritesStatusCounts | null;
}

export interface CdpPackagesMetricsResponse {
  totalPackages: number;
  criticalPackages: number;
  coveragePercent: number;
  coverageTrend: number | null;
  activeStewards: number;
  unassignedCritical: number;
  needsAttention: number;
  escalated: number;
}

export interface AkritesMetrics {
  totalPackages: number;
  criticalPackages: number;
  coveragePercent: number;
  coverageTrend: number | null;
  activeStewards: number;
  unassignedCritical: number;
  needsAttention: number;
  escalated: number;
}

export interface AkritesActivityRow {
  id: string;
  stewardshipId: string;
  packagePurl: string;
  packageName: string;
  packageEcosystem: string;
  actor: CdpActivityActor | null;
  actorType: string;
  activityType: string;
  content: string | null;
  metadata: Record<string, unknown> | null;
  stewardshipStatus: string;
  createdAt: string;
}

export interface AkritesActivityResponse {
  rows: AkritesActivityRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AkritesActivityRowVM extends AkritesActivityRow {
  relativeTime: string;
  accentStyle: string;
  statusDotStyle: string;
  statusLabelStyle: string;
  activityIcon: string;
  formattedStatus: string;
  formattedActivityLabel: string;
  action: { label: string; variant: 'default' | 'blue' | 'red' } | null;
  actorDisplay: string | null;
  actorAvatarUrl: string | null;
  actorInitials: string | null;
}

export interface AkritesActivityDayGroup {
  label: string;
  isToday: boolean;
  rows: AkritesActivityRowVM[];
}

export type AkritesDashboardTab = 'overview' | 'packages' | 'triage' | 'risk-matrix';

// ===== Triage Board =====

export type AkritesTriageStatus = Extract<AkritesStatus, 'unassigned' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive'>;

export interface AkritesTriageBoardColumnConfig {
  status: AkritesTriageStatus;
  label: string;
  /** Hex color for the column icon circle and gradient tint. */
  color: string;
  /** Pre-computed FontAwesome class string bound directly in the template. */
  iconClass: string;
  actionLabel: string;
  actionVariant: 'blue' | 'red' | 'default';
  /** Pre-computed Tailwind class string for the action button. */
  actionButtonClass: string;
}

/** `AkritesPackage` extended with pre-computed display values to avoid method calls in bindings. */
export interface AkritesTriagePackageVM extends AkritesPackage {
  healthColor: string;
  healthLabel: string;
  vulnColor: string;
}

export interface AkritesTriageColumnState {
  packages: AkritesTriagePackageVM[];
  total: number;
  loading: boolean;
  error: boolean;
}

// ===== Scatter / Risk Matrix =====

export interface CdpScatterPoint {
  purl: string;
  name: string;
  criticalityScore: number | null;
  healthScore: number | null;
  stewardshipStatus: string | null;
  stewardshipId: string | null;
  openVulns: number | null;
}

export interface CdpScatterResponse {
  points: CdpScatterPoint[];
  total: number;
}

export interface AkritesScatterPoint {
  purl: string;
  name: string;
  impactScore: number | null;
  healthScore: number | null;
  status: AkritesStatus;
  stewardshipId: number | null;
  openVulns: number;
}

export interface AkritesScatterResponse {
  points: AkritesScatterPoint[];
  total: number;
}

export interface AkritesScatterPointVM extends AkritesScatterPoint {
  left: string;
  top: string;
  bg: string;
  borderColor: string;
  healthLabel: string;
  statusLabel: string;
}

export interface AkritesLegendItemVM {
  status: AkritesStatus;
  bg: string;
  borderColor: string;
  label: string;
  count: number;
}
