// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DEFAULT_ORG_SCOPE, ORG_SCOPE_ALL_TOOLTIP, ORG_SCOPE_OPTIONS } from '../constants/org-people.constants';
import type { OrgLensOrgScope, OrgScopeFilter, OrgScopeOption } from '../interfaces';

/** `orgScope` value → organization scope, or `null` when it is not one of the allowed values. */
export function parseOrgScopeFilter(value: string | null | undefined): OrgScopeFilter | null {
  return ORG_SCOPE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** Organization scope → `?orgScope=` URL value, `null` (dropped) at the default. */
export function orgScopeUrlParam(scope: OrgScopeFilter): OrgScopeFilter | null {
  return scope === DEFAULT_ORG_SCOPE ? null : scope;
}

/**
 * The scope a read serves for a pick (lfx-self-serve-ops#1219): `insights` only when the account has an Insights
 * organization, else `all` — an account with none, or with no `ORG_LENS_ORG_SCOPE` row, offers only All related organizations.
 */
export function effectiveOrgScope(scope: OrgScopeFilter, info: Pick<OrgLensOrgScope, 'hasInsightsOrg'> | null | undefined): OrgScopeFilter {
  return scope === 'insights' && info?.hasInsightsOrg === true ? 'insights' : 'all';
}

/**
 * The scope a caption names: the pick, except `all` once the account is known to have no Insights organization. Unlike
 * {@link effectiveOrgScope}, it keeps the pick while the account's scope metadata is still loading (`null`), so a
 * caption does not flash All related organizations on every page load.
 */
export function servedOrgScopeForCaption(scope: OrgScopeFilter, info: Pick<OrgLensOrgScope, 'hasInsightsOrg'> | null | undefined): OrgScopeFilter {
  return info?.hasInsightsOrg === false ? 'all' : scope;
}

/** Dropdown options for an account: All related organizations carries the related-organization count once it is known. */
export function orgScopeOptions(info: Pick<OrgLensOrgScope, 'relatedOrgCount'> | null | undefined): OrgScopeOption[] {
  return ORG_SCOPE_OPTIONS.map((option) =>
    option.value === 'all' && info && info.relatedOrgCount > 0 ? { ...option, label: `${option.label} (${info.relatedOrgCount})` } : { ...option }
  );
}

/** Tooltip describing what the picked scope counts, naming the account's Insights organization when it is known. */
export function orgScopeTooltip(scope: OrgScopeFilter, info: Pick<OrgLensOrgScope, 'insightsOrgName'> | null | undefined): string {
  if (scope === 'all') return ORG_SCOPE_ALL_TOOLTIP;
  const name = info?.insightsOrgName?.trim() || 'the organization';
  return `Counts only ${name}, the organization on its LFX Insights page, and only repositories LFX Insights counts. Maintainer roles are not affected.`;
}
