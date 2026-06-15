// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OsspreyStatusCounts, OspreySortKey, OsspreyEcosystem, OsspreyLifecycle, OsspreyHealthBand } from '../interfaces';

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
