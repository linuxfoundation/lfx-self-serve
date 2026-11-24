// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensEmployeeViewException, OrgLensViewMode } from '../interfaces/org-lens-view-mode.interface';

/** The two Company Lens view modes. */
export const ORG_LENS_VIEW_MODES: readonly OrgLensViewMode[] = ['full', 'employee'];

export const ORG_LENS_FULL_VIEW: OrgLensViewMode = 'full';

export const ORG_LENS_EMPLOYEE_VIEW: OrgLensViewMode = 'employee';

/** Error code a route behind a hidden page or panel answers with in the all employee view. */
export const ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_CODE = 'EMPLOYEE_VIEW_FORBIDDEN';

/**
 * The `/api/orgs/:orgUid/lens/*` paths (relative to the `/lens` mount) an all-employee caller may reach, one slot per page story
 * of epic #5845. Anything not listed is refused by default, so a newly added lens route can never return names or emails to an
 * employee by accident. A page approved for the employee view fills ONLY its own slot (and applies `redactForEmployeeView` in its
 * handlers). The slots are kept one per line, with a comment line between them, so the page branches merge without conflicts.
 */
export const ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS_BY_PAGE: Readonly<Record<string, readonly RegExp[]>> = {
  // The gate itself: the page asks "may I view this company?".
  access: [/^\/(read-check|edit-check)\/?$/i],
  // Shared shell data several pages read (company scope, no people).
  shared: [/^\/org-scope\/?$/i],
  // overview
  overview: [/^\/foundations-and-projects\/?$/i],
  // projects
  projects: [/^\/projects(\/search)?\/?$/i, /^\/workspaces\/?$/i],
  // project-detail
  'project-detail': [
    /^\/projects\/[^/]+\/(hero|influence|trend)\/?$/i,
    /^\/projects\/[^/]+\/leaderboard\/(technical|ecosystem)\/?$/i,
    /^\/projects\/[^/]+\/leaderboard\/technical\/organizations\/[^/]+\/?$/i,
    /^\/projects\/[^/]+\/cards\/[^/]+(\/roster)?\/?$/i,
  ],
  // contributions
  contributions: [/^\/contributions\/?$/i],
  // events
  events: [/^\/events(\/(summary|foundations))?\/?$/i],
  // training
  training: [/^\/training\/(stats|filter-options|groups)\/?$/i],
  // meetings
  meetings: [/^\/meetings\/(kpi|spend|influence)\/?$/i],
};

/** Every approved path across all pages. */
export const ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS: readonly RegExp[] = Object.values(ORG_LENS_EMPLOYEE_VIEW_ALLOWED_PATHS_BY_PAGE).flat();

/** User-safe 403 message for the all employee view. Says "company": copy-terminology rule, epic #5060. */
export const ORG_LENS_EMPLOYEE_VIEW_FORBIDDEN_MESSAGE = 'This part of the company view is not available to all employees.';

/** User-safe 403 message for a write attempted in the (read-only) all employee view. */
export const ORG_LENS_EMPLOYEE_VIEW_READ_ONLY_MESSAGE = 'The company view for all employees is read-only.';

/** Page a hidden page or route redirects to in the all employee view. */
export const ORG_LENS_EMPLOYEE_VIEW_HOME_PAGE = 'overview';

/** How long a resolved employee-view verdict for one caller and company is reused, so a page's parallel lens calls cost one lookup. */
export const ORG_LENS_EMPLOYEE_VIEW_CACHE_TTL_MS = 60 * 1000;

/** How long the previous member-company index may be served while a newer one refreshes or keeps failing (the memberships change on a days-long cadence). */
export const ORG_LENS_EMPLOYEE_VIEW_MEMBER_INDEX_MAX_STALE_MS = 60 * 60 * 1000;

/** After a failed member-index refresh the previous index keeps being served and no new full read starts for this long. */
export const ORG_LENS_EMPLOYEE_VIEW_MEMBER_INDEX_RETRY_BACKOFF_MS = 30 * 1000;

/** Upper bound on cached employee-view verdicts per server process. */
export const ORG_LENS_EMPLOYEE_VIEW_CACHE_MAX_ENTRIES = 1000;

/**
 * Field names `stripPersonalFields` removes from every object, at any depth, in the all employee view.
 * Matched case-insensitively and ignoring `_` and `-`, so `first_name`, `firstName` and `FIRST-NAME` are one entry.
 *
 * Deliberately only unambiguous person fields. A bare `name` is NOT listed: it is also a project's, a company's
 * or an event's name, and stripping it everywhere would empty the page. A page whose person name travels under a
 * bare key (`name`, `title` ...) passes it in `stripPersonalFields`' `extraFields` for that route.
 */
export const ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS: readonly string[] = [
  'email',
  'emails',
  'emailAddress',
  'emailAddresses',
  'primaryEmail',
  'workEmail',
  'companyEmail',
  'companyEmails',
  'firstName',
  'lastName',
  'fullName',
  'displayName',
  'personName',
  'contactName',
  'memberName',
  'employeeName',
  'attendeeName',
  'learnerName',
  'speakerName',
  'registrantName',
  'participantName',
];

/**
 * The exceptions allow-list: fields that stay visible in the all employee view on one page. EMPTY at launch, and
 * every entry is a reviewed product-owner decision (epic #5845), never a developer's call. Add one object per
 * (page, field) with its `reason` and `approvedBy`; do not widen `ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS` instead.
 */
export const ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS: readonly OrgLensEmployeeViewException[] = [];

/**
 * Page segments the all employee view hides entirely: no left-nav link, and `orgLensFullViewOnlyGuard()` redirects the
 * route to Overview. Each hidden page's API routes answer 403 (`blockEmployeeView` on the orgs router, or the Crowdfunding
 * controller's own refusal for Initiatives and Donations). The sidebar reads this list, so a page needs no sidebar change
 * of its own; EasyCLA stays open for the company's CLA Manager (`OrgLensViewModeService.hiddenPages`).
 */
export const ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES: readonly string[] = ['memberships', 'people', 'easycla', 'profile', 'groups', 'initiatives', 'donations'];

/** Selector row badge for the company a caller reaches only through the all employee view. */
export const NAVBAR_ORG_EMPLOYEE_VIEW_ROLE = {
  label: 'Employee',
  icon: 'fa-light fa-user',
  tooltip: 'You work for this company. You can see a read-only summary with no names or email addresses.',
} as const;

/**
 * Consumer ISP and regional mailbox domains (registrable form) that never prove employment for the all employee view, beyond the
 * webmail labels `isPersonalEmailDomain` already covers. A member company that really owns one of these is still reached by its
 * grants; only the employee-view email proof ignores them.
 */
export const ORG_LENS_EMPLOYEE_VIEW_CONSUMER_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
  'charter.net',
  'earthlink.net',
  'btinternet.com',
  'virginmedia.com',
  'sky.com',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  't-online.de',
  'web.de',
  'libero.it',
  'rediffmail.com',
  'naver.com',
  'daum.net',
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'yeah.net',
  'mail.ru',
  'yandex.ru',
  'rambler.ru',
]);
