// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  OsspreyStatusCounts,
  OspreySortKey,
  OsspreyEcosystem,
  OsspreyLifecycle,
  OsspreyHealthBand,
  OsspreyEscalationPath,
  OsspreyInactiveReason,
  OsspreyStewardRole,
  OsspreyUpdatableStatus,
} from '../interfaces';

/** Status pills shown above the OSSPREY package queue, in display order. */
export const OSSPREY_STATUS_PILLS: { key: keyof OsspreyStatusCounts; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'open', label: 'Open' },
  { key: 'assessing', label: 'Assessing' },
  { key: 'active', label: 'Active' },
  { key: 'needs_attention', label: 'Needs attention' },
  { key: 'escalated', label: 'Escalated' },
];

/** Sort options for the OSSPREY package queue. */
export const OSSPREY_SORT_OPTIONS: Array<{ value: OspreySortKey; label: string }> = [
  { value: 'risk', label: 'Risk priority' },
  { value: 'impact', label: 'Impact score' },
  { value: 'health', label: 'Health (worst first)' },
  { value: 'vulns', label: 'Open vulnerabilities' },
  { value: 'name', label: 'Name (A–Z)' },
];

/** Ecosystem options for the OSSPREY filter panel. */
export const OSSPREY_ECOSYSTEM_OPTIONS: Array<{ value: OsspreyEcosystem | ''; label: string }> = [
  { value: '', label: 'All ecosystems' },
  { value: 'npm', label: 'npm' },
  { value: 'maven', label: 'Maven' },
  { value: 'pypi', label: 'PyPI' },
  { value: 'go', label: 'Go' },
  { value: 'cargo', label: 'Cargo' },
];

/** Lifecycle options for the OSSPREY filter panel. */
export const OSSPREY_LIFECYCLE_OPTIONS: Array<{ value: OsspreyLifecycle | ''; label: string }> = [
  { value: '', label: 'All lifecycle' },
  { value: 'active', label: 'Active' },
  { value: 'stable', label: 'Stable' },
  { value: 'declining', label: 'Declining' },
  { value: 'abandoned', label: 'Abandoned' },
];

/** Health band options for the OSSPREY filter panel (bands match the design spec). */
export const OSSPREY_HEALTH_OPTIONS: Array<{ value: OsspreyHealthBand | ''; label: string }> = [
  { value: '', label: 'All health' },
  { value: 'healthy', label: 'Healthy (70+)' },
  { value: 'fair', label: 'Fair (50–69)' },
  { value: 'concerning', label: 'Concerning (30–49)' },
  { value: 'critical', label: 'Critical (<30)' },
];

/** Open-vulnerability options for the OSSPREY filter panel. */
export const OSSPREY_VULN_OPTIONS: Array<{ value: 'any' | 'high' | 'critical' | ''; label: string }> = [
  { value: '', label: 'Any vulns' },
  { value: 'any', label: 'Has any vulnerability' },
  { value: 'high', label: 'High or above' },
  { value: 'critical', label: 'Critical only' },
];

/** Steward role options for the assign-steward picker. */
export const OSSPREY_STEWARD_ROLE_OPTIONS: Array<{ value: OsspreyStewardRole; label: string }> = [
  { value: 'lead', label: 'Lead steward' },
  { value: 'co_steward', label: 'Co-steward' },
];

/**
 * Escalation resolution paths shown as selectable cards in the escalate modal.
 * Titles + descriptions mirror the design (design/LFX-OSSPREY-Admin-Dashboard.html).
 */
export const OSSPREY_ESCALATION_PATHS: Array<{ value: OsspreyEscalationPath; title: string; description: string }> = [
  { value: 'right_of_first_refusal', title: 'Right of first refusal', description: 'Give the project a clear opportunity to act before any external action.' },
  { value: 'replace_the_dependency', title: 'Replace the dependency', description: 'Recommend a healthier alternative to downstream consumers.' },
  { value: 'find_vendor_for_lts', title: 'Find a vendor for LTS', description: 'A member company commits to long-term support.' },
  { value: 'consortium_adopts_maintainership', title: 'Consortium adopts maintainership', description: 'LFX coordinates a group to take technical ownership.' },
  {
    value: 'compensating_controls_monitor',
    title: 'Compensating controls + monitor',
    description: 'Document residual risk where the issue is not directly fixable.',
  },
  { value: 'namespace_takeover', title: 'Namespace takeover (last resort)', description: 'Coordinate with the registry for an ownership transfer.' },
];

/** Reasons captured when moving a stewardship to `inactive`. */
export const OSSPREY_INACTIVE_REASON_OPTIONS: Array<{ value: OsspreyInactiveReason; label: string }> = [
  { value: 'quarterly_cadence_missed', label: 'Quarterly cadence missed' },
  { value: 'stepped_down', label: 'Steward stepped down' },
  { value: 'no_longer_critical', label: 'No longer critical' },
];

/** Statuses an admin can set directly via the status-update modal. */
export const OSSPREY_UPDATABLE_STATUS_OPTIONS: Array<{ value: OsspreyUpdatableStatus; label: string }> = [
  { value: 'assessing', label: 'Assessing' },
  { value: 'active', label: 'Active' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'inactive', label: 'Inactive' },
];
