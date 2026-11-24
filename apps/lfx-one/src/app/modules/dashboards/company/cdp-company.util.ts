// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { CDP_COMPANY_ERROR_CODES, CDP_COMPANY_SECTION_KEYS } from '@lfx-one/shared/constants';
import type {
  CdpCompanySectionPayloads,
  CdpCompanySectionViewState,
  CdpCompanyShellState,
  CdpSectionKey,
  OrgLensEmptyStateName,
} from '@lfx-one/shared/interfaces';

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** `YYYY-MM` → "March 2026" (FR-034's "last active `<month year>`"); null when absent or not a month. */
export function formatCdpCompanyMonth(month: string | null | undefined): string | null {
  const match = month ? MONTH_PATTERN.exec(month) : null;
  if (!match) return null;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return MONTH_FORMAT.format(new Date(Date.UTC(Number(match[1]), monthIndex, 1)));
}

/** True for a CDP section key — guards a URL segment before it is reused in a redirect. */
export function isCdpSectionKey(value: string | null | undefined): value is CdpSectionKey {
  return !!value && (CDP_COMPANY_SECTION_KEYS as readonly string[]).includes(value);
}

/** The refusal `code` of a CDP BFF error, when the body carries one. */
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse)) return undefined;
  const body: unknown = error.error;
  return body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined;
}

/**
 * A failed `GET /api/companies/:cdpId`: 404 is "no company at this address", whatever the reason (outsider, unknown,
 * malformed — FR-012); a failed audience check is "could not verify" (FR-013); anything else could not be loaded.
 */
export function classifyCdpPageError(error: unknown): CdpCompanyShellState {
  if (errorCode(error) === CDP_COMPANY_ERROR_CODES.ROLE_GRANTS_UNAVAILABLE) return 'could-not-verify';
  if (error instanceof HttpErrorResponse && error.status === 404) return 'no-company';
  return 'could-not-load';
}

/** A failed section read, by the refusal's stated `code`, never by status alone (contracts/bff-cdp-companies.md). */
export function classifyCdpSectionError(error: unknown): CdpCompanySectionViewState {
  switch (errorCode(error)) {
    case CDP_COMPANY_ERROR_CODES.SECTION_OFF_BY_DESIGN:
      return 'off-by-design';
    case CDP_COMPANY_ERROR_CODES.SECTION_NO_ACCESS:
      return 'no-access';
    case CDP_COMPANY_ERROR_CODES.SECTION_COULD_NOT_VERIFY:
    case CDP_COMPANY_ERROR_CODES.ROLE_GRANTS_UNAVAILABLE:
      return 'could-not-verify';
    default:
      return 'could-not-load';
  }
}

/** True when a table section answered no rows. Dashboard, Profile and Training always have something to show. */
export function isCdpSectionEmpty(data: CdpCompanySectionPayloads[CdpSectionKey]): boolean {
  return 'rows' in data && data.rows.length === 0;
}

/** The shared Company Lens empty state a shell state renders; null for `loading` and `ok`. */
export function cdpCompanyShellEmptyState(state: CdpCompanyShellState): OrgLensEmptyStateName | null {
  switch (state) {
    case 'no-company':
      return 'no-company';
    case 'could-not-verify':
      return 'section-could-not-verify';
    case 'could-not-load':
      return 'section-could-not-load';
    case 'low-activity-none':
      return 'low-activity-none';
    case 'low-activity-not-enough':
      return 'low-activity-not-enough';
    default:
      return null;
  }
}

/** The shared Company Lens empty state a section state renders; null for `loading` and `ready`. */
export function cdpCompanySectionEmptyState(state: CdpCompanySectionViewState): OrgLensEmptyStateName | null {
  switch (state) {
    case 'empty':
      return 'section-empty';
    case 'off-by-design':
      return 'off-by-design';
    // `SECTION_NO_ACCESS` is only ever Meetings or Groups refused to a caller who is not LF staff (FR-031, FR-032).
    case 'no-access':
      return 'section-staff-only';
    case 'could-not-verify':
      return 'section-could-not-verify';
    case 'could-not-load':
      return 'section-could-not-load';
    default:
      return null;
  }
}
