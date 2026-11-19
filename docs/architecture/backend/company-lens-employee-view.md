<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Company Lens all employee view (access gate and redaction tools)

Internal engineering note for epic #5845. Not Help Center copy. User-facing text says "company", never "organization" (epic #5060); identifiers keep the `org` names.

The all employee view is a **mode** of the Company Lens (`OrgLensViewMode = 'full' | 'employee'`, `packages/shared`): a reduced, read-only, privacy-safe view for an ordinary employee of an LF member company. Counts, charts and company-level totals only; no names or email addresses unless a reviewed exception says so.

## Who is in it

`assertOrgLensRead` (`server/helpers/org-lens-read-access.helper.ts`) has a third qualification, `employee-view`, tried **last**: after the roster (`org-grant`) and the authorizer (`auditor-entitlement`) have both answered cleanly and refused. A grant holder or LF staff therefore never reaches it and never sees less.

`OrgEmployeeViewService` (`server/services/org-employee-view.service.ts`) proves both of these for the **effective** user (the impersonation target, never the admin). To see a company's all employee view, a user must have:

1. **A validated email on one of the company's domains, and the company is an active LF member.** A **verified** email (`resolveVerifiedUserEmails`, strict) on the company's `primary_domain` or one of its registered `domain_aliases` from member-service (the Salesforce domain list, so every domain of a multi-domain company counts). A subdomain address (`eng.acme.com`) matches a company that registered the parent; a personal mailbox domain or a public suffix never matches. The website host is never used. Membership is the query service's `is_member:true` tag.
2. **The company as a present employer in their individual work history.** An entry on the profile's **Work history & Affiliations** tab (`/profile/attributions`) with **no end date** whose employer **name** matches the company's name (`normalizeCompanyName`: case, accents, punctuation, `&`/`and`, a leading "The" and trailing Inc/LLC/Ltd-style words are ignored). The list is read with `CdpService.getWorkExperiencesForKnownUser`, read-only (it never creates a CDP member), and **only the entry's employer name, start date and end date are used**: no CDP organization id, no CDP-to-company mapping, no CDP engagement data.

The company is **found from the validated email** (`b2b_org` records tagged `is_member:true` whose `primary_domain` or `domain_aliases` equal a candidate domain, read with the BFF machine token because the caller was just refused `b2b_org#auditor`, which the query service applies per row; every returned record's domains are re-checked) and then **confirmed against the present work-history entries**. The URL never names the company.

**One company at a time.** An all employee view user reaches a single company (admins with a grant are unaffected). When several companies meet both rules, the one whose present entry has the **most recent start date** is granted and every other is cut off (`other-company`, 403); a tie resolves to the first in stable order (name, then uid), and two entries naming the same company count once, by the latest start. Nothing is stored: the choice is recomputed from the current work history and emails on each lookup, so changing an employer or a validated email changes the answer at the next check.

**Planned, not in this release.** (a) When the individual profile has a concept of a **primary** employer (written through to CDP), it becomes a third requirement. (b) Once an email validation has a **freshness** concept, the view can expand to show several companies.

The outcome is held 60 s **per caller** (not per requested company) in a cache shared by every `OrgEmployeeViewService` instance, so the role-grants, selector, read-gate and slug-resolver calls of one page share a single lookup. Anything unproven is a denial (403). A lookup that **fails** (work history, query service, token, auth-service) is a 503 `ROLE_GRANTS_UNAVAILABLE`, never "not an employee"; a failure is never kept.

Employee access supersedes CLA-only classification for the same company (selector row, address resolver, client state); the caller's own CLA Manager scope is still asked by the EasyCLA gate. The resolver tries the employee view before the CLA scope and, if the employee lookup is unavailable and the CLA scope does not hit, answers a structured 503 `ROLE_GRANTS_UNAVAILABLE` (never a 404 the client would cache). Slug addresses fall back too.

Roll-up segments never qualify: the roll-up gate shares a roster, which skips the employee-view attempt, and drops any company that comes back `employee-view`.

**Rollout flag.** `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED` (`ServerFeatureFlag.OrgLensEmployeeView`) is OFF by default and a complete no-op when off. Turn it on only after every page story has applied the tools below; until then an employee-view caller would read pages that are not yet redacted.

## The mode, for server handlers

```ts
import { getOrgLensViewMode, resolveOrgLensViewMode } from '../helpers/org-lens-read-access.helper';

getOrgLensViewMode(req, orgUid); // 'full' | 'employee', synchronous, memoized per request
await resolveOrgLensViewMode(req, orgUid, operation); // runs the gate first, then answers the mode
```

`getOrgLensViewMode` fails closed: before the gate has resolved on this request it answers `'employee'`. `requireOrgLensAccess` is mounted on `/api/orgs/:orgUid/lens/*`, so the mode is resolved before any lens handler runs. That middleware also answers 403 `EMPLOYEE_VIEW_FORBIDDEN` to any non-GET/HEAD request in the employee view (read-only).

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

   `stripPersonalFields(data, { page, extraFields? })` is the underlying pure helper. It removes the keys in `ORG_LENS_EMPLOYEE_VIEW_PERSONAL_FIELDS` (`email`, `firstName`, `fullName`, `speakerName` ...), the route's `extraFields`, and any value shaped like an email address. String values are also scrubbed of embedded emails, `mailto:` links and personal profile URLs (LinkedIn, X); names in free text are not detected, so a field that carries prose with names needs `blockEmployeeView` or `extraFields`. A bare `name` is not in the default list (it is also a project or company name), so pass it as `extraFields` where it is a person. Also decide whether a number derived from people is itself revealing.

3. **Exceptions: `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS`** (`packages/shared/src/constants/org-lens-view-mode.constants.ts`). Empty at launch. A field stays visible only through one `{ page, field, reason, approvedBy }` entry decided by the product owner. Public technical data (GitHub usernames, contribution counts) needs no entry because it is not in the personal-field list.

4. **Hidden page in the client:** add its page segment to `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES` (same file; the sidebar drops it) and add `canActivate: [orgLensFullViewOnlyGuard()]` to its route, which redirects to Overview in the employee view. The server half is item 1; the UI alone does not count.

## Client

`GET /api/orgs/me/role-grants` carries `employeeView?: { orgUid, orgName, orgSlug? }`, computed only for a caller with no grant and not staff. It is looked up for every grant-less, non-staff caller on a clean roster, with no affiliation pre-filter (that verdict names one employer; this lookup considers all present ones), so LF contractors take the same path, in parallel with the CLA-manager and affiliation lookups. `OrgRoleGrantsService.employeeViewOrgUid` holds it. `OrgLensViewModeService` answers `viewMode()` / `isEmployeeView()` for the selected company (`modeFor(uid)` for others); a real grant or staff always wins. The selector lists the company (`OrgItem.employeeView`), `/api/orgs/resolve/:segment` resolves its address (`OrgResolveResponse.employeeView`), and the empty state opens the lens instead of "no company linked". The client is UX only: the server refuses and redacts regardless.

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

## Final page matrix (epic #5845)

Stories #5847-#5859 each handled one page; this table is the consolidated result and the thing to check a release against. "Blocked" means every API route behind it answers 403 `EMPLOYEE_VIEW_FORBIDDEN` (`blockEmployeeView`, or `assertOrgLensClaRead` for EasyCLA) and the client hides the entry point.

| Page / panel                                       | Employee view                                                                                         | Story        | Enforced by                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Overview                                           | Shown, redacted; memberships link dropped                                                             | #5847        | `redactForEmployeeView` on the foundations-and-projects and overview analytics handlers                               |
| Projects                                           | Shown; people anonymised, workspace management hidden                                                 | #5848        | `redactProjectsForEmployeeView`; writes refused by the read-only rule                                                 |
| Project detail                                     | Shown; Technical Influence cards open, Ecosystem Influence blocked                                    | #5849        | `blockEmployeeViewEcosystemCard`, `blockEmployeeView` on the ecosystem organization leaderboard, embedded-email scrub |
| Code contributions                                 | Aggregates only; commits view and employee filters refused                                            | #5850        | In-controller 403 plus `redactForEmployeeView`                                                                        |
| Events                                             | Summary, foundations and event list shown; attendee and speaker drawers blocked                       | #5851        | `blockEmployeeView` on `/events/:eventId/attendees` and `/speakers`                                                   |
| Training                                           | Counts and group tables shown; roster drill-down blocked; learners-not-on-people-list count removed   | #5852        | `blockEmployeeView` on `/training/groups/employees`; the stat is nulled in the controller                             |
| Meetings                                           | Shown, redacted                                                                                       | #5853        | `redactForEmployeeView`                                                                                               |
| Crowdfunding (company donations)                   | Initiative, date and amount only; no donor name, email or anonymous flag                              | #5854        | `redactForEmployeeView` with `extraFields`                                                                            |
| Memberships (and key contact / board seat modals)  | Hidden                                                                                                | #5855        | `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES`, `orgLensFullViewOnlyGuard()`, `blockEmployeeView`                              |
| People (all tabs, drawers, Access tab)             | Hidden                                                                                                | #5856        | Prefix mounts `router.use('/:orgUid/lens/people')` and `'/:orgUid/lens/access'`                                       |
| EasyCLA                                            | Hidden unless the caller holds the CLA Manager scope                                                  | #5857        | `assertOrgLensClaRead`                                                                                                |
| Profile (canonical record, addresses, logo upload) | Hidden                                                                                                | #5858        | `blockEmployeeViewOnOrgRecord` on `/uid/:uid*` and `/:id`                                                             |
| Groups                                             | Hidden                                                                                                | #5859        | `blockEmployeeView` on `/lens/groups`                                                                                 |
| ROI Metrics                                        | Never (LF staff only, as before)                                                                      | pre-existing | `requireOrgLensRoiAudience`                                                                                           |
| Every non-GET under `/api/orgs/:orgUid/lens/*`     | Refused                                                                                               | S1 (#5846)   | `requireOrgLensAccess` read-only rule                                                                                 |
| Org-scoped `/api/analytics/*` rows                 | Refused unless the route opts in with `allowEmployeeView`; only the four Overview involvement rows do | S1 (#5846)   | `requireOrgAnalyticsAccess`                                                                                           |

### How this is checked in CI (story #5860)

- `routes/orgs.route.employee-view.spec.ts` reads the route table off the assembled router. Every route behind a page in `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES` must answer 403 `EMPLOYEE_VIEW_FORBIDDEN` in the employee view and must not in the full view; each blocked panel route and every non-GET lens route is asserted too. A hidden page with no route mapping in that spec fails the suite, so adding a page to the hidden list forces its API to be listed.
- `routes/analytics.route.employee-view.spec.ts` asserts every org-scoped analytics route refuses the employee view, except the four Overview involvement paths in its `ALLOWED_FOR_EMPLOYEE_VIEW` set, which must carry `requireOrgAnalyticsAccessAllowingEmployeeView` (those two checks activate once the Overview story, #5847, is in the base).
- `helpers/org-lens-employee-view-sweep.spec.ts` is the stray name and email sweep: the redaction tool removes every listed field at any depth, and every `org-lens-*.controller.ts` needs a reviewed disposition (`redacts`, `blocked`, `counts-only`, `staff-only`), so a new Company Lens controller cannot ship unreviewed.
- These specs stub the read gate's decision. They do not prove who qualifies as an employee (that is `org-employee-view.service.spec.ts`) and they do not run Playwright: the repo's e2e suite signs in through Auth0 against a real dev server, so the employee-view user journey (allowed pages, nav, redirects) has to be walked by hand against a seeded environment. See the checklist below.

## Rollout checklist for `LFX_ORG_LENS_EMPLOYEE_VIEW_ENABLED`

The flag is OFF by default and a complete no-op when off. Do not turn it on in any shared environment until all of these hold.

1. **Every page story is merged** (#5847-#5859) and `ORG_LENS_EMPLOYEE_VIEW_HIDDEN_PAGES` lists `memberships`, `people`, `easycla`, `profile`, `groups`. The page branches each rewrite that one line, so the merge result must be one array, not five declarations.
2. **The CI specs above pass** on the merged tree, including the panel and controller-inventory checks that only run once the hidden list is non-empty.
3. **Overview analytics decision made (resolved).** The four Overview involvement routes (`org-foundation-coverage`, `org-involvement-contributors-monthly`, `org-involvement-maintainers-monthly`, `org-involvement-event-attendance-monthly`) return only aggregate counts and series, so the product owner opted them in through `requireOrgAnalyticsAccessAllowingEmployeeView`; their handlers still redact. Every other `/api/analytics/*` row keeps refusing the employee view (`analytics.route.employee-view.spec.ts`).
4. **Exceptions allow-list reviewed.** `ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS` is empty; confirm that is still the product owner's decision.
5. **Walk the journey** with a seeded employee of a member company on a non-production environment, with no grant and not staff: the selector lists the company with the Employee badge; the nav shows only the shown pages; each hidden route (`/people`, `/memberships`, `/easycla`, `/profile`, `/groups`) redirects to Overview; the blocked panels are absent; a direct API call to each hidden prefix answers 403 `EMPLOYEE_VIEW_FORBIDDEN`; a grant holder and an LF staff user still see everything.
6. **Impersonation**: an admin impersonating an employee sees the employee's view, never more.
7. **Upstream load**: the verdict costs a CDP, member-service and authorizer lookup once per 60 s per caller and company; confirm those services tolerate the added reads.
8. **Enable per environment** (dev, then staging, then production), watching `EMPLOYEE_VIEW_FORBIDDEN` and `ROLE_GRANTS_UNAVAILABLE` counts. Turning the flag off restores the previous behavior with no data change.
9. **User docs**: publish the `docs/user/company/` description of who gets this view and what it shows when the flag goes generally available (not before; dark-launched features are not documented).

## Known open questions

- **Other org-scoped analytics rows** (all except the four Overview involvement rows, e.g. `org-contributors-monthly`, `org-maintainers-*`, `org-training-*`, `org-certified-employees-*`, `org-event-*`, `training-enrollments`, `membership-tier` and similar) are refused for the employee view. That is the safe default; confirm no shown page depends on one.
- **Free text.** `stripPersonalFields` drops email-shaped values but not an address embedded in a sentence. Project detail scrubs commit messages (`scrubEmbeddedEmails`); meeting titles, event names and crowdfunding initiative text are not scrubbed.
- **Bare name keys.** `name`, `committerName`, `username`, `donorName`, `supporterName` and `jobTitle` are not in the default personal-field list. Each shown page must pass them as `extraFields` or block the route; the sweep cannot see a payload field a handler adds later.
- **Real data verification.** The specs prove gating and tool behavior with stubbed gates and synthetic payloads. The Snowflake-backed handlers' real responses have not been diffed against the redaction rules for a large account.

## Product decisions (resolved)

- **Small counts are allowed, with no minimum-group-size floor.** A count does not reveal a name.
- **Crowdfunding** initiative, transaction and announcement routes (`/api/crowdfunding/*`): a simple client block is accepted; the data is not sensitive.
- **Roll-ups** (the all-company roll-up and per-family roll-ups) are not available to employee-view users; they are for admins and staff only.
