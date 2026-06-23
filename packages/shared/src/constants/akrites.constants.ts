// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AkritesStatusCounts,
  AkritesSortKey,
  AkritesEcosystem,
  AkritesLifecycle,
  AkritesHealthBand,
  AkritesEscalationPath,
  AkritesInactiveReason,
  AkritesStewardRole,
  AkritesUpdatableStatus,
  AkritesTriageBoardColumnConfig,
  AkritesStatus,
  AkritesDashboardTab,
} from '../interfaces';
import { lfxColors } from './colors.constants';

/** Status pills shown above the Akrites package queue, in display order. */
export const AKRITES_STATUS_PILLS: { key: keyof AkritesStatusCounts; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'open', label: 'Open' },
  { key: 'assessing', label: 'Assessing' },
  { key: 'active', label: 'Active' },
  { key: 'needs_attention', label: 'Needs attention' },
  { key: 'escalated', label: 'Escalated' },
];

/** Sort options for the Akrites package queue. */
export const AKRITES_SORT_OPTIONS: Array<{ value: AkritesSortKey; label: string }> = [
  { value: 'risk', label: 'Risk priority' },
  { value: 'impact', label: 'Impact score' },
  { value: 'health', label: 'Health (worst first)' },
  { value: 'vulns', label: 'Open vulnerabilities' },
  { value: 'name', label: 'Name (A–Z)' },
];

/** Ecosystem options for the Akrites filter panel. */
export const AKRITES_ECOSYSTEM_OPTIONS: Array<{ value: AkritesEcosystem | ''; label: string }> = [
  { value: '', label: 'All ecosystems' },
  { value: 'npm', label: 'npm' },
  { value: 'maven', label: 'Maven' },
  { value: 'pypi', label: 'PyPI' },
  { value: 'go', label: 'Go' },
  { value: 'cargo', label: 'Cargo' },
];

/** Lifecycle options for the Akrites filter panel. */
export const AKRITES_LIFECYCLE_OPTIONS: Array<{ value: AkritesLifecycle | ''; label: string }> = [
  { value: '', label: 'All lifecycle' },
  { value: 'active', label: 'Active' },
  { value: 'stable', label: 'Stable' },
  { value: 'declining', label: 'Declining' },
  { value: 'abandoned', label: 'Abandoned' },
];

/** Health band options for the Akrites filter panel (bands match the design spec). */
export const AKRITES_HEALTH_OPTIONS: Array<{ value: AkritesHealthBand | ''; label: string }> = [
  { value: '', label: 'All health' },
  { value: 'healthy', label: 'Healthy (70+)' },
  { value: 'fair', label: 'Fair (50–69)' },
  { value: 'concerning', label: 'Concerning (30–49)' },
  { value: 'critical', label: 'Critical (<30)' },
];

/** Open-vulnerability options for the Akrites filter panel. */
export const AKRITES_VULN_OPTIONS: Array<{ value: 'any' | 'high' | 'critical' | ''; label: string }> = [
  { value: '', label: 'Any vulns' },
  { value: 'any', label: 'Has any vulnerability' },
  { value: 'high', label: 'High or above' },
  { value: 'critical', label: 'Critical only' },
];

/** Steward role options for the assign-steward picker. */
export const AKRITES_STEWARD_ROLE_OPTIONS: Array<{ value: AkritesStewardRole; label: string }> = [
  { value: 'lead', label: 'Lead steward' },
  { value: 'co_steward', label: 'Co-steward' },
];

/**
 * Escalation resolution paths shown as selectable cards in the escalate modal.
 * Titles + descriptions mirror the design (design/LFX-AKRITES-Admin-Dashboard.html).
 */
export const AKRITES_ESCALATION_PATHS: Array<{ value: AkritesEscalationPath; title: string; description: string }> = [
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
export const AKRITES_INACTIVE_REASON_OPTIONS: Array<{ value: AkritesInactiveReason; label: string }> = [
  { value: 'quarterly_cadence_missed', label: 'Quarterly cadence missed' },
  { value: 'stepped_down', label: 'Steward stepped down' },
  { value: 'no_longer_critical', label: 'No longer critical' },
];

/** Statuses an admin can set directly via the status-update modal. */
export const AKRITES_UPDATABLE_STATUS_OPTIONS: Array<{ value: AkritesUpdatableStatus; label: string }> = [
  { value: 'assessing', label: 'Assessing' },
  { value: 'active', label: 'Active' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'inactive', label: 'Inactive' },
];

/** Valid dashboard tabs for the Akrites module. */
export const AKRITES_VALID_TABS = new Set<AkritesDashboardTab>(['overview', 'packages', 'triage', 'risk-matrix']);

/** Default dashboard tab when none is specified. */
export const AKRITES_DEFAULT_TAB: AkritesDashboardTab = 'overview';

/** Default visible statuses for the risk matrix when all are selected (length = 8 indicates all statuses). */
export const AKRITES_DEFAULT_VISIBLE_STATUSES: AkritesStatus[] = [
  'unassigned',
  'needs_attention',
  'escalated',
  'blocked',
  'inactive',
  'open',
  'assessing',
  'active',
];

/** Total number of distinct Akrites statuses. */
export const AKRITES_TOTAL_STATUSES = 8;

/** Color palette and labels for Akrites statuses displayed in UI. */
export const AKRITES_STATUS_COLORS: Record<AkritesStatus, { bg: string; border: string }> = {
  unassigned: { bg: lfxColors.gray[500], border: lfxColors.white },
  open: { bg: lfxColors.blue[500], border: lfxColors.white },
  assessing: { bg: lfxColors.violet[600], border: lfxColors.white },
  active: { bg: lfxColors.emerald[500], border: lfxColors.white },
  needs_attention: { bg: lfxColors.amber[600], border: lfxColors.white },
  escalated: { bg: lfxColors.red[500], border: lfxColors.white },
  blocked: { bg: lfxColors.transparent, border: lfxColors.red[500] },
  inactive: { bg: lfxColors.transparent, border: lfxColors.gray[400] },
};

/** Human-readable labels for Akrites statuses. */
export const AKRITES_STATUS_LABELS: Record<AkritesStatus, string> = {
  unassigned: 'Unassigned',
  needs_attention: 'Needs attention',
  escalated: 'Escalated',
  blocked: 'Blocked',
  inactive: 'Inactive',
  open: 'Open',
  assessing: 'Assessing',
  active: 'Active',
};

/** Display order for Akrites statuses in the risk matrix legend and filters. */
export const AKRITES_STATUS_ORDER: AkritesStatus[] = ['unassigned', 'needs_attention', 'escalated', 'blocked', 'inactive', 'open', 'assessing', 'active'];

/**
 * Committee UID for the "LFX Akrites" working group — the source of assignable stewards.
 * Members of this committee are fetched via GET /api/committees/:id/members.
 * See: https://app.lfx.dev/groups/8bffb08a-3707-4f8f-9e1c-0cbca8a4dfb6
 */
export const AKRITES_STEWARD_COMMITTEE_UID = 'f41a2f37-a4b0-441f-bacf-49a0a9a5dd8d'; // DEV ONLY: AY Group (7 members) — revert to 8bffb08a-3707-4f8f-9e1c-0cbca8a4dfb6

/** Empty status counts object with all statuses initialized to 0. */
export const AKRITES_EMPTY_STATUS_COUNTS: AkritesStatusCounts = {
  all: 0,
  unassigned: 0,
  open: 0,
  assessing: 0,
  active: 0,
  needs_attention: 0,
  escalated: 0,
  blocked: 0,
  inactive: 0,
};

const _BTN_BASE = 'h-8 px-3.5 rounded-full border bg-white text-[12.5px] font-medium cursor-pointer transition-colors';

/** Columns shown on the Triage board tab, in display order. All columns are always rendered. */
export const AKRITES_TRIAGE_COLUMNS: AkritesTriageBoardColumnConfig[] = [
  {
    status: 'unassigned',
    label: 'Unassigned',
    color: '#62748e',
    iconClass: 'fa-light fa-user-xmark text-[11px]',
    actionLabel: 'Assign steward',
    actionVariant: 'blue',
    actionButtonClass: `${_BTN_BASE} border-blue-200 text-blue-600 hover:bg-blue-50 hover:border-blue-400`,
  },
  {
    status: 'needs_attention',
    label: 'Needs attention',
    color: '#f97316',
    iconClass: 'fa-light fa-binoculars text-[11px]',
    actionLabel: 'Review',
    actionVariant: 'default',
    actionButtonClass: `${_BTN_BASE} border-gray-300 text-gray-700 hover:bg-gray-50`,
  },
  {
    status: 'escalated',
    label: 'Escalated',
    color: '#e5484d',
    iconClass: 'fa-light fa-arrow-up text-[11px]',
    actionLabel: 'Resolve',
    actionVariant: 'red',
    actionButtonClass: `${_BTN_BASE} border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400`,
  },
  {
    status: 'blocked',
    label: 'Blocked',
    color: '#e5484d',
    iconClass: 'fa-light fa-circle-info text-[11px]',
    actionLabel: 'Resolve blocker',
    actionVariant: 'red',
    actionButtonClass: `${_BTN_BASE} border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400`,
  },
  {
    status: 'inactive',
    label: 'Inactive',
    color: '#90a1b9',
    iconClass: 'fa-light fa-clock text-[11px]',
    actionLabel: 'Reassign',
    actionVariant: 'default',
    actionButtonClass: `${_BTN_BASE} border-gray-300 text-gray-700 hover:bg-gray-50`,
  },
];
