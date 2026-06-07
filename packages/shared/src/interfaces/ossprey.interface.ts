// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export type OsspreyStatus = 'unassigned' | 'open' | 'assessing' | 'active' | 'needs_attention' | 'escalated' | 'blocked' | 'inactive';
export type OsspreyLifecycle = 'active' | 'stable' | 'declining' | 'abandoned';
export type OsspreyEcosystem = 'npm' | 'maven' | 'pypi' | 'go';
export type OsspreyHealthBand = 'healthy' | 'fair' | 'concerning' | 'critical';
export type OspreySeverity = 'critical' | 'high' | 'medium' | 'low';
export type OspreySortKey = 'risk' | 'impact' | 'health' | 'vulns' | 'name';

export interface OsspreyAdvisory {
  id: string;
  severity: OspreySeverity;
  description: string;
  state: 'Open' | 'Patched';
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
  lifecycle: OsspreyLifecycle;
  healthScore: number;
  impactScore: number;
  busFactor: number;
  monthsStale: number;
  vulnCount: number;
  vulnSeverity: OspreySeverity | null;
  status: OsspreyStatus;
  stewardIds: string[];
  lastActivityLabel: string;
  lastActivityTime: string;
  weeklyDownloads: string;
  dependentCount: string;
  directDependentCount: string;
  scoreCardScore: string;
  lastRelease: string;
  lastCommit: string;
  repoUrl: string;
  supplyChainMapping: 'High' | 'Medium' | 'Low';
  provenance: 'Full' | 'Partial' | 'None';
  hasSecurityMd: boolean;
  ecosystemReach: string;
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

export interface OsspreyStats {
  totalPackages: number;
  coveragePct: number;
  activeStewards: number;
  unassignedCritical: number;
  needsAttention: number;
  escalated: number;
}
