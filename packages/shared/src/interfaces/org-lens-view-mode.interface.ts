// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * How much of the Company Lens (internally Org Lens) a caller sees for one company.
 *
 * - `full`: today's lens. A grant holder, an auditor-entitled caller or LF staff.
 * - `employee`: the reduced, read-only, privacy-safe "all employee" view (epic #5845). Counts, charts and
 *   company-level totals only; no names or email addresses unless an entry in the exceptions allow-list says so.
 */
export type OrgLensViewMode = 'full' | 'employee';

/**
 * The company a caller reaches only through the all employee view, as `GET /api/orgs/me/role-grants` reports it.
 * Resolved server-side (current employer, active LF member, verified company email) and present only for a caller
 * who holds no grant, so it never narrows what a grant holder or LF staff already see.
 */
export interface OrgLensEmployeeViewGrant {
  /** The company's account id (18-char SFID), the same value the lens routes take as `:orgUid`. */
  orgUid: string;
  /** Company display name for the selector row. */
  orgName: string;
  /** Lowercase URL-identity slug member-service published for the company, or null. Lets a `/company/{slug}/…` address resolve. */
  orgSlug?: string | null;
}

/**
 * One reviewed, product-owner-approved exception to the "no names or email addresses" rule: a field that stays
 * visible on one page in the all employee view. Nothing is exposed by default, so an entry is the only way a
 * personal field survives {@link stripPersonalFields}.
 */
export interface OrgLensEmployeeViewException {
  /** The page the exception applies to, as the page story passes it to `stripPersonalFields` (e.g. `project-detail`). */
  page: string;
  /** The exact field name that may stay. */
  field: string;
  /** Why the field is safe to show (e.g. the data is already public on GitHub / LFX Insights). */
  reason: string;
  /** The product owner decision or ticket that approved it. */
  approvedBy: string;
}

/** Why a caller is not in the all employee view of a company. Every one of these is "no access" (403), never an outage. */
export type OrgEmployeeViewDenial = 'no-employer' | 'employer-mismatch' | 'other-company' | 'no-verified-company-email' | 'holds-full-access';

/** A clean answer to "is this caller in the all employee view?". A failed lookup is a rejection, never a verdict. */
export type OrgEmployeeViewVerdict =
  | { eligible: true; org: OrgLensEmployeeViewGrant }
  /** `holds-full-access` carries the company: the caller qualifies as an employee but holds `b2b_org#auditor` there, so the read gate resolves them `full`. */
  | { eligible: false; reason: OrgEmployeeViewDenial; org?: OrgLensEmployeeViewGrant };

/** Options of the server's `stripPersonalFields` / `redactForEmployeeView`. */
export interface StripPersonalFieldsOptions {
  /** The page being served (`overview`, `projects`, `events` ...). Selects its entries in the exceptions allow-list. */
  page: string;
  /** Extra field names to remove on this route, for a person name that travels under a bare key (`name`, `title` ...). */
  extraFields?: readonly string[];
  /** Override the allow-list; tests only. Production always uses `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS`. */
  exceptions?: readonly OrgLensEmployeeViewException[];
}
