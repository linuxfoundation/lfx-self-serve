// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Names of the Org Lens empty states shipped in spec 053 phase 1 (`ORG_LENS_EMPTY_STATE_COPY` keys), plus `affiliated-no-grant` (#4225). */
export type OrgLensEmptyStateName =
  | 'no-organization'
  | 'affiliated-non-member'
  | 'no-access'
  | 'wrong-organization'
  | 'not-found-staff'
  | 'could-not-load'
  | 'staff-check-failed'
  | 'contractor-no-grant'
  | 'affiliated-no-grant'
  | 'section-empty'
  | 'section-could-not-load'
  | 'section-no-access'
  | 'section-could-not-verify';

/** #2961 — the Org Lens read gate's answer for the organization a contractor has selected; `admitted` is `undefined` until it lands. */
export interface OrgLensContractorProbe {
  uid: string;
  admitted: boolean | undefined;
}

/** #2961 — the server's verdict for an LF contractor: refused (render `contractor-no-grant`) or admitted (render the page). */
export type OrgLensContractorVerdict = 'refused' | 'admitted';

/** FR-016 rules 2–4 — the states an outage in the caller's own lookup renders ahead of any access-themed one. */
export type OrgLensLookupBlocker = Extract<OrgLensEmptyStateName, 'could-not-load' | 'staff-check-failed'>;

/**
 * Outcome of one section request, classified for the shared empty state (FR-014/FR-015).
 *
 * `denied` vs `unverifiable` is decided by the refusal's stated `code`, never by status alone: the
 * Org Lens read gate answers 403 `FORBIDDEN` when the caller lacks access and 503
 * `ROLE_GRANTS_UNAVAILABLE` when it could not check — and the second must never read as the first.
 */
export type OrgLensSectionOutcome = 'records' | 'empty' | 'denied' | 'unverifiable' | 'failed';

/** `OrgLensSectionOutcome` minus `empty` — what a section's error-classification reduces to (never `empty`, which only `sectionEmptyState` assigns from a 0-count response). */
export type OrgLensSectionErrorOutcome = Exclude<OrgLensSectionOutcome, 'empty'>;

/** What the primary / secondary control does when it is not a plain link. */
export type OrgLensEmptyStateActionKind = 'retry' | 'org-list' | 'reset-filters' | 'contact-support';

export interface OrgLensEmptyStateAction {
  label: string;
  /** External URL — rendered as an anchor. */
  href?: string;
  /** In-app route — rendered as a router link. */
  route?: string[];
  /** `retry` / `reset-filters` emit the component's outputs; `contact-support` opens the support messenger; `org-list` renders the caller's own organizations (`values.orgList`) as the control, each row emitting `orgSelected`. */
  action?: OrgLensEmptyStateActionKind;
}

export interface OrgLensEmptyStateCopy {
  headline: string;
  /** May interpolate `{orgName}` `{noun}` `{period}` `{correlationId}`. The two states a first-time visitor can reach (`no-organization`, `no-access`) open with the one line on what Organization Lens is (FR-002). */
  reason: string;
  /** Font Awesome class. */
  icon: string;
  /** Exactly one primary action, except `section-empty` with no applicable filter (renders reason-only). */
  primary?: OrgLensEmptyStateAction;
  secondary?: OrgLensEmptyStateAction;
  /** `section-empty` only — wording when the section has no selectable period (FR-013 "No {noun} recorded"). */
  noPeriod?: { headline: string; reason: string };
  /** `org-list` primaries only — the reason when there are no rows to list (the secondary is promoted in the list's place). */
  noList?: { reason: string };
}

/** Resolved values an empty state may interpolate. `orgName` is honoured only for states rendered to a caller who holds the org (FR-019). */
export interface OrgLensEmptyStateValues {
  orgName?: string | null;
  /**
   * #4314 — the caller's *own* affiliated employer, read from their profile. Interpolated by
   * `affiliated-non-member` only. Unlike `orgName` it never names an organization the caller
   * addressed but does not hold, so the FR-017 withholding rule does not apply to it.
   */
  employerName?: string | null;
  /** FR-013 — the section's plural noun ("meetings", "commits"). */
  noun?: string;
  /** FR-013 — human-readable selected period; absent ⇒ the `noPeriod` wording. */
  period?: string | null;
  correlationId?: string | null;
  /** FR-008 — the caller's own held organizations, rendered as the primary action list. */
  orgList?: { uid: string; name: string }[];
  /** FR-013 — false when no caller-set filter narrows the query, so `section-empty` renders reason-only. Defaults true. */
  filterActive?: boolean;
}

/** #4314 — what the employer-membership lookup established; see `OrgLensEmployerAffiliation.membership`. */
export type OrgLensEmployerMembership = 'member' | 'non-member' | 'unresolved';

/**
 * #4314 — the caller's own employer affiliation as the Org Lens empty states need it:
 * who their profile says they work for, and whether that company holds any active membership
 * in an LF-hosted foundation. Answered by `GET /api/profile/employer-affiliation`, which is
 * deliberately *not* behind the Org Lens read gate — a caller with no grant must be able to
 * learn why they have none.
 */
export interface OrgLensEmployerAffiliation {
  /**
   * Display name of a job the caller holds *now* (a work-history entry with no end date); `null` when
   * they have none, a profile of only past jobs included — someone between jobs is not affiliated.
   * With several concurrent jobs it is the LF-member one where there is one, else the first.
   *
   * Always as the caller's own profile spells it, never as the matched Salesforce account spells it:
   * it is read back to them in their own sentence, and the match is deliberately looser than equality.
   */
  employerName: string | null;
  /**
   * What the lookup established about the caller's current employers:
   *
   * - `member` — at least one of them holds an active membership in an LF-hosted foundation.
   * - `non-member` — every one of them resolved to a Salesforce account, and none of those accounts
   *   has an active membership. This is the only value that may render "is not a member": it is a
   *   checked negative.
   * - `unresolved` — the lookup succeeded but settled nothing. Two cases produce it: the caller has no
   *   current employer at all (`employerName` is then `null`), or at least one of their current employers
   *   could not be matched to an account. An unmatched name is not proof of no membership: the match is
   *   by name, and a member company whose account name differs from the profile's wording lands here.
   *
   * `unresolved` is a successful answer of "unknown", not an outage: callers keep whatever they would show
   * without an employer answer — today the `no-organization` empty state — and reserve `could-not-load` for
   * a request that actually failed. Neither an unknown nor a failure may ever render as `non-member`.
   */
  membership: OrgLensEmployerMembership;
}
