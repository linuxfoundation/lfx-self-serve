// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Names of the Org Lens empty states shipped in spec 053 phase 1 (`ORG_LENS_EMPTY_STATE_COPY` keys). */
export type OrgLensEmptyStateName =
  | 'no-organization'
  | 'no-access'
  | 'wrong-organization'
  | 'not-found-staff'
  | 'could-not-load'
  | 'staff-check-failed'
  | 'section-empty'
  | 'section-could-not-load'
  | 'section-no-access'
  | 'section-could-not-verify';

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
  /** One line on what Organization Lens is — present for every state a first-time visitor can reach. */
  productLine?: string;
  /** May interpolate `{orgName}` `{noun}` `{period}` `{correlationId}`. */
  reason: string;
  /** Font Awesome class. */
  icon: string;
  /** Exactly one primary action, except `section-empty` with no applicable filter (renders reason-only). */
  primary?: OrgLensEmptyStateAction;
  secondary?: OrgLensEmptyStateAction;
  /** `section-empty` only — wording when the section has no selectable period (FR-013 "No {noun} recorded"). */
  noPeriod?: { headline: string; reason: string };
}

/** Resolved values an empty state may interpolate. `orgName` is honoured only for states rendered to a caller who holds the org (FR-019). */
export interface OrgLensEmptyStateValues {
  orgName?: string | null;
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
