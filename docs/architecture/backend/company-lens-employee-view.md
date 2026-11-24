<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Company Lens all employee view (access gate and redaction tools)

Internal engineering note for epic #5845. Not Help Center copy. User-facing text says "company", never "organization" (epic #5060); identifiers keep the `org` names.

The all employee view is a **mode** of the Company Lens (`OrgLensViewMode = 'full' | 'employee'`, `packages/shared`): a reduced, read-only, privacy-safe view for an ordinary employee of an LF member company. Counts, charts and company-level totals only; no names or email addresses unless a reviewed exception says so.

## Who is in it

`assertOrgLensRead` (`server/helpers/org-lens-read-access.helper.ts`) has a third qualification, `employee-view`, tried **last**: after the roster (`org-grant`) and the authorizer (`auditor-entitlement`) have both answered cleanly and refused. A grant holder or LF staff therefore never reaches it and never sees less.

`OrgEmployeeViewService` (`server/services/org-employee-view.service.ts`) proves both of these for the **effective** user (the impersonation target, never the admin). To see a company's all employee view, a user must have:

1. **A validated email on the registered domain of an active Linux Foundation member company.** A **verified** email (`resolveVerifiedUserEmails`, strict) on the `company_domain` recorded on the company's active Linux Foundation membership. A subdomain address (`eng.acme.com`) matches a company that registered the parent; a personal mailbox domain or a public suffix never matches. The website host is never used. A membership records one domain, so a company reached only through a registered alias domain is not matched (it is denied, never admitted).
2. **The company as a present employer in their individual work history.** An entry on the profile's **Work history & Affiliations** tab (`/profile/attributions`) with **no end date** whose employer **name** matches the company's name (`normalizeCompanyName`: case, accents, punctuation, `&`/`and`, a leading "The" and trailing Inc/LLC/Ltd-style words are ignored). The list is read with `CdpService.getWorkExperiencesForKnownUser`, read-only (it never creates a CDP member), and **only the entry's employer name, start date and end date are used**: no CDP organization id, no CDP-to-company mapping, no CDP engagement data.

The company is **found from the validated email** (the active Linux Foundation memberships, `project_membership` with project `tlf`, read with the BFF machine token because the caller was just refused `b2b_org#auditor`, which the query service applies per row; the index is cached per process for 10 minutes and every membership's project and status are re-checked) and then **confirmed against the present work-history entries**. The URL never names the company, and a membership carries no slug, so the company is reached by its id: the app links employee-view companies by id, and a shared or bookmarked slug address (`/company/acme-inc/...`) does not open for an employee-view user (a known limit; the id address does). An empty or malformed membership read is a retriable 503, never a cached "not a member".

**One company at a time.** An all employee view user reaches a single company (admins with a grant are unaffected). When several companies meet both rules, the one whose present entry has the **most recent start date** is granted and every other is cut off (`other-company`, 403); a tie resolves to the first in stable order (name, then uid), and two entries naming the same company count once, by the latest start. Nothing is stored: the choice is recomputed from the current work history and emails on each lookup, so changing an employer or a validated email changes the answer at the next check.

**Who is asked at all.** Only a caller with **no Org Lens grant who is not LF staff** (the same entry rule as the CLA-only list) is ever looked up, and the same rule is enforced everywhere: the read gate, `OrgEmployeeViewService.resolveReduced` (the selector row and the address resolver) and role-grants. A grant holder or staff member skips the lookup entirely (`has-grants`), so the selector and the gate agree and admins pay nothing. If the roster cannot be read the answer is a retriable 503, never a denial.

**Not email proof.** The Linux.com forwarding alias (`linux.com` and the stage's `LINUX_FORWARD_DOMAIN`) and consumer ISP mail domains (`ORG_LENS_EMPLOYEE_VIEW_CONSUMER_MAIL_DOMAINS`) never count as a company address, on top of the webmail providers `isPersonalEmailDomain` covers. A strict lookup counts auth-service's primary email only when it equals the email the session verified, and never falls back to the session email.

**Accepted for this release.** A former employee keeps access until they end the work-history entry or the company stops being an active member: the end date is self-edited and verified emails do not expire. This is a known limit, accepted because the view shows no personal data, and is closed by the freshness work in (b) below.

**Planned, not in this release.** (a) When the individual profile has a concept of a **primary** employer (written through to CDP), it becomes a third requirement. (b) Once an email validation has a **freshness** concept, the view can expand to show several companies.

The outcome is held 60 s **per caller** (not per requested company) in a cache shared by every `OrgEmployeeViewService` instance, so the role-grants, selector, read-gate and slug-resolver calls of one page share a single lookup. Anything unproven is a denial (403). On `GET /api/orgs/me/role-grants` a lookup that fails or times out is reported as `employeeViewLookup: 'failed'` (never as "not an employee"), and the client shows the retryable outage state. A lookup that **fails** (work history, query service, token, auth-service) is a 503 `ROLE_GRANTS_UNAVAILABLE`, never "not an employee"; a failure is never kept.

Employee access supersedes CLA-only classification for the same company (selector row, address resolver, client state); the caller's own CLA Manager scope is still asked by the EasyCLA gate. The resolver tries the employee view before the CLA scope and, if the employee lookup is unavailable and the CLA scope does not hit, answers a structured 503 `ROLE_GRANTS_UNAVAILABLE` (never a 404 the client would cache). Slug addresses fall back too.

Roll-up segments never qualify: the roll-up gate shares a roster, which skips the employee-view attempt, and drops any company that comes back `employee-view`.

**Rollout flags.** `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` (`ServerFeatureFlag.OrgLensEmployeeView`) is OFF by default and a complete no-op when off. Turn it on only after every page story has applied the tools below; until then an employee-view caller would read pages that are not yet redacted.

**Dev check before turning the flag on.** The company lookup reads the active Linux Foundation memberships with the BFF machine token (no `b2b_org` grant is needed). Confirm in dev that a member-company employee is found and that no "Membership read returned no active members" warning is logged.

**Staff preview.** `LFX_ORG_LENS_EMPLOYEE_VIEW_IMPERSONATION_ONLY` (`ServerFeatureFlag.OrgLensEmployeeViewImpersonationOnly`) opens the view only for a request made under an active impersonation session, so LF staff can impersonate an employee and see what that employee would see in production while no real employee is let in. Real callers are answered exactly as when both flags are off. Every place that opens the view asks `isOrgLensEmployeeViewEnabled(req)` (`org-lens-employee-view-flag.helper.ts`), so the two flags have one definition. Impersonation itself needs the `can_impersonate` claim (see [User Impersonation](./impersonation.md)), so no separate staff check is added. The impersonated user is judged by every rule on this page: no grants, not staff, a validated email on a member company's domain, and that company as a current employer. The staff preview is for pages that have already shipped their redaction; it does not make an unredacted page safe, so keep it off until the page stories you want to check are deployed.

## The mode, for server handlers

```ts
import { getOrgLensViewMode, resolveOrgLensViewMode } from '../helpers/org-lens-read-access.helper';

getOrgLensViewMode(req, orgUid); // 'full' | 'employee', synchronous, memoized per request
await resolveOrgLensViewMode(req, orgUid, operation); // runs the gate first, then answers the mode
```

`getOrgLensViewMode` fails closed: before the gate has resolved on this request it answers `'employee'`. `requireOrgLensAccess` is mounted on `/api/orgs/:orgUid/lens/*`, so the mode is resolved before any lens handler runs. That middleware also answers 403 `EMPLOYEE_VIEW_FORBIDDEN` to any non-GET/HEAD request in the employee view. That read-only guarantee covers the lens prefix only. Writes outside it, such as the company record routes (`PUT /api/orgs/uid/:uid`, `POST /api/orgs/uid/:uid/logo`), are not covered by this gate: they rely on member-service `writer` authorization, and the Profile page story (#5858) additionally blocks them for the employee view (`blockEmployeeViewOnOrgRecord`).

A roll-up segment answers `'full'` from `getOrgLensViewMode` without running any gate. That is a precondition, not an authorization: every roll-up route must stay mounted behind `requireOrgLensAccess` and the roll-up gate, which admit grant holders only. A route that serves a roll-up without them cannot rely on `getOrgLensViewMode` or `blockEmployeeView` to refuse an employee.

## Redaction tools (how a page story uses them)

Each page story applies these to **one** page. Nothing is exposed by default.

1. **Hidden page or side panel: `blockEmployeeView`** (`server/middleware/block-employee-view.middleware.ts`). Mount it on every API route behind it; it answers `403 EMPLOYEE_VIEW_FORBIDDEN` in the employee view and passes everyone else.

   ```ts
   router.get('/:orgUid/lens/people', blockEmployeeView, (req, res, next) => controller.getPeople(req, res, next));
   ```

2. **Shown page with names or emails: `redactForEmployeeView`** (`server/helpers/org-lens-employee-view.helper.ts`). One line in the handler; the full view gets its response untouched.

   ```ts
   res.json(redactForEmployeeView(req, orgUid, result, { page: 'projects', extraFields: ['name'] }));
   ```

   `stripPersonalFields(data, { page, extraFields? })` is the underlying pure helper. It removes the keys in `ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS` (`email`, `firstName`, `fullName`, `speakerName` ...), the route's `extraFields`, and any value shaped like an email address. String values are also scrubbed of embedded emails, `mailto:` links and personal profile URLs (LinkedIn, X); names in free text are not detected, so a field that carries prose with names needs `blockEmployeeView` or `extraFields`. The default list holds names and email addresses only. An avatar or picture URL, a phone number and a non-public LFID username (`username`, `lfUsername`) are not in it, so a page that returns any of them must pass them through `extraFields`; story #5861 (S16) audits each page for these. A bare `name` is not in the default list (it is also a project or company name), so pass it as `extraFields` where it is a person. Also decide whether a number derived from people is itself revealing.

3. **Exceptions: `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS`** (`packages/shared/src/constants/org-lens-view-mode.constants.ts`). Empty at launch. A field stays visible only through one `{ page, field, reason, approvedBy }` entry decided by the product owner. Public technical data (GitHub usernames, contribution counts) needs no entry because it is not in the personal-field list. A field the route lists in `extraFields` is removed even when an exception names it: the route's explicit removal wins. An exception is keyed by page and normalized field name, so it un-strips that field name everywhere in that page's payload, nested objects included; if the same key also carries personal data elsewhere on the page, handle it with `extraFields` or a handler change rather than an exception.

4. **Hidden page in the client:** add its page segment to `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES` (same file; the sidebar drops it) and add `canActivate: [orgLensFullViewOnlyGuard()]` to its route, which redirects to Overview in the employee view. The server half is item 1; the UI alone does not count.

## Client

`GET /api/orgs/me/role-grants` carries `employeeView?: { orgUid, orgName, orgSlug? }`, computed only for a caller with no grant and not staff. It is looked up for every grant-less, non-staff caller on a clean roster, with no affiliation pre-filter (that verdict names one employer; this lookup considers all present ones), so LF contractors take the same path, in parallel with the CLA-manager and affiliation lookups. `OrgRoleGrantsService.employeeViewOrgUid` holds it. `OrgLensViewModeService` answers `viewMode()` / `isEmployeeView()` for the selected company (`modeFor(uid)` for others); a real grant or staff always wins. The selector lists the company (`OrgItem.employeeView`), `/api/orgs/resolve/:segment` resolves its address (`OrgResolveResponse.employeeView`), and the empty state opens the lens instead of "no company linked". The client is UX only: the server refuses and redacts regardless.

**Slug addresses.** The employee company is invisible to query-service, so it takes part in slug uniqueness and the `prefer` tie-break alongside a readable company that shares its slug: a shared slug is ambiguous unless `prefer` names one of them. That check is fail-soft (a failed lookup keeps the readable answer).

## Every `assertOrgLensRead` consumer

| Consumer                                                                                         | Employee view                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `requireOrgLensAccess` on `/api/orgs/:orgUid/lens/*`                                             | Admitted, read-only (non-GET/HEAD is 403); pages redact or `blockEmployeeView` per story                                                                                                         |
| `assertOrgLensClaRead` / `requireOrgLensClaAccess` (EasyCLA router, mounted before `orgsRouter`) | **Refused** (403 `EMPLOYEE_VIEW_FORBIDDEN`) unless the caller holds the CLA Manager scope                                                                                                        |
| `assertOrgAnalyticsRead` (`/api/analytics/*`)                                                    | **Refused by default**; a reviewed, redacting route opts in with `{ allowEmployeeView: true }`. `filterReadableAccountIds` / `filterConfirmedReadableAccountIds` never consult the employee view |
| `resolveOrgLensRollUp`                                                                           | Never (shared roster skips the attempt; `employee-view` results are dropped)                                                                                                                     |
| ROI, groups, meetings, training, people handlers                                                 | Behind the lens prefix; each page story applies `blockEmployeeView` or `redactForEmployeeView`                                                                                                   |

**Client flags are employee-only flags.** `employeeView` on role-grants, the selector row and the resolver is published through `resolveReduced`, which also asks the authorizer for `b2b_org#auditor` on that company. A caller who holds it (an authorizer-only reader such as a key contact absent from the roster) resolves `full` at the read gate, so they get no employee flag and the client keeps the full view. An authorizer failure publishes nothing.

The same overlap needs a positive signal, because the client never stores authorizer entitlements in its grant sets: for such a caller `resolveReduced` returns `holds-full-access` with the company, and the server publishes it as `RoleGrantsResponse.fullAccessOrgUid`, an `OrgItem.fullAccess` selector row (with the company slug) and `OrgResolveResponse.fullAccess`. The client records it (`OrgLensViewModeService.noteFullAccessAddressed`, `fullAccessOrgUids`) so CLA-only classification, addressability, the empty state and the view mode all treat the company as full, even when the caller also manages its CLAs.
