// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Where in the all employee view a register row sits (epic #5845, story #5861). `hidden` rows describe the five
 * pages the view hides entirely; `all` rows are cross-cutting (small counts, free text, exports, logs).
 */
export type OrgLensEmployeeViewRegisterPage =
  | 'overview'
  | 'projects'
  | 'project-detail'
  | 'code-contributions'
  | 'events'
  | 'training'
  | 'meetings'
  | 'crowdfunding'
  | 'navigation'
  | 'hidden'
  | 'all';

/**
 * The verdict for one place a person-level value could reach an employee-view user.
 * - `allowed`: public code contribution data only (a commit, pull request or maintainer entry anyone can find on
 *   GitHub or LFX Insights). Needs a `publicBasis`.
 * - `count-only`: must never leave the API as a value; only a count of people (or nothing) may.
 * - `company-level`: not personal data (a company, project, foundation or event name, or a company-level total).
 *   Listed so a reviewer can see the field was looked at.
 * - `own-data`: the signed-in user's own name or avatar, not another person's.
 */
export type OrgLensEmployeeViewRegisterVerdict = 'allowed' | 'count-only' | 'company-level' | 'own-data';

/** What keeps a `count-only` value away from the user, or lets an `allowed` one through. */
export type OrgLensEmployeeViewRegisterEnforcement =
  /** The route answers 403 in the employee view (`blockEmployeeView` or a page-specific block). */
  | 'blocked-403'
  /** `assertOrgAnalyticsRead` refuses the employee view unless the route opts in with `allowEmployeeView`. */
  | 'refused-by-default'
  /** The server removes the field (`stripPersonalFields`, the shared key list or a route's `extraFields`). */
  | 'stripped'
  /** The server replaces each person with an opaque placeholder and keeps only the count. */
  | 'anonymised'
  /** The server never runs the query for this caller, so the value is not read, cached or sent. */
  | 'not-queried'
  /** Allowed: the key is not in the shared personal-field list, so it passes `stripPersonalFields` untouched. */
  | 'not-in-field-list'
  /** Allowed: a personal-field key kept through an `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS` entry. */
  | 'exceptions-allow-list'
  /** The value is a count, a company-level figure or the user's own data by construction. */
  | 'by-construction'
  /** Nothing stops it today. Always paired with status `gap` or `unverified`. */
  | 'none';

/**
 * - `enforced`: the page PRs on top of the gate (#5863) enforce the verdict.
 * - `gap`: a name, email or free text can reach the user today; `followUp` says how to close it.
 * - `decision`: enforced as written, but the product owner has a call to make (small counts, derived names).
 * - `unverified`: not provable from code alone; `followUp` says what to check.
 */
export type OrgLensEmployeeViewRegisterStatus = 'enforced' | 'gap' | 'decision' | 'unverified';

/** Where the value originates. */
export type OrgLensEmployeeViewRegisterSource = 'github' | 'insights' | 'cdp' | 'lfx' | 'snowflake' | 'member-service' | 'crowdfunding' | 'authorizer';

/** One field (or one group of fields that always travel together) a person-level value could be read from. */
export interface OrgLensEmployeeViewRegisterEntry {
  /** Stable id, `<page>.<surface>.<field>`; unique. */
  id: string;
  page: OrgLensEmployeeViewRegisterPage;
  /** Component, panel or table the value renders in (or `payload only` when the UI never shows it). */
  surface: string;
  /** Method and path (or the client-only surface) that carries it. */
  endpoint: string;
  /** The payload key(s), `a / b` when several always travel together. */
  field: string;
  /** A fixture-style value (reserved example domains only). */
  example: string;
  source: OrgLensEmployeeViewRegisterSource;
  verdict: OrgLensEmployeeViewRegisterVerdict;
  enforcement: OrgLensEmployeeViewRegisterEnforcement;
  status: OrgLensEmployeeViewRegisterStatus;
  /** One line: what the data is and why the verdict holds. */
  note: string;
  /** Required for `allowed`: why the value is public. */
  publicBasis?: string;
  /** `stripped` rows only: whether the key is in the shared list or passed per route as `extraFields`. */
  strippedBy?: 'shared-list' | 'route-extra-fields';
  /** Required unless `enforced`: the concrete next step. */
  followUp?: string;
}

/** How the employee view treats one lens route (end state with the page PRs applied). */
export type OrgLensEmployeeViewEndpointTreatment =
  /** Shown; the payload is counts, charts and company-level figures. */
  | 'counts'
  /** Shown; the payload passes through the redaction tools (strip or anonymise). */
  | 'redacted'
  /** Shown; named rows limited to public code contribution data. */
  | 'public-code-only'
  /** 403 in the employee view (hidden page, side panel or person-level list). */
  | 'blocked'
  /** Not reachable by an employee: the route has its own, stricter audience gate (LF staff, CLA Manager). */
  | 'other-gate'
  /** A write; the lens gate refuses every non-GET in the employee view. */
  | 'read-only-refused'
  /** Shown; the payload carries free text nobody redacts (a register row with status `gap` says which). */
  | 'free-text';

/** One route under `/api/orgs/:orgUid/lens`, path-parameter names normalised to `:p`. */
export interface OrgLensEmployeeViewEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** `/:p/lens/...`, every `:param` written as `:p`. */
  path: string;
  /** The page story that owns the treatment. */
  page: OrgLensEmployeeViewRegisterPage;
  treatment: OrgLensEmployeeViewEndpointTreatment;
}

/** How an `org-*.interface.ts` payload file is treated by the shape scan. */
export type OrgLensEmployeeViewInterfaceFileClass = 'payload' | 'hidden-page' | 'internal' | 'query-only' | 'staff-only';

/** An analytics route file allowed to pass `allowEmployeeView: true`. Empty until a reviewed route opts in. */
export interface OrgLensEmployeeViewAnalyticsOptIn {
  /** Path of the source file, relative to `apps/lfx-one/src/server`. */
  file: string;
  /** What the route returns and why it holds no person-level value. */
  reason: string;
}

/** A person-bearing name found in a payload interface file (a property or a type) and its review. */
export interface OrgLensEmployeeViewReviewedShape {
  /** `<interface file>:<property or type name>`. */
  key: string;
  /** The register entry id that covers it, or `presentation` for a CSS-class or fallback-initials property. */
  coveredBy: string;
}
