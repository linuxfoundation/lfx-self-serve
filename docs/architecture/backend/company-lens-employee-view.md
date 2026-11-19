<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Company Lens all employee view (access gate and redaction tools)

Internal engineering note for epic #5845. Not Help Center copy. User-facing text says "company", never "organization" (epic #5060); identifiers keep the `org` names.

The all employee view is a **mode** of the Company Lens (`OrgLensViewMode = 'full' | 'employee'`, `packages/shared`): a reduced, read-only, privacy-safe view for an ordinary employee of an LF member company. Counts, charts and company-level totals only; no names or email addresses unless a reviewed exception says so.

## Who is in it

`assertOrgLensRead` (`server/helpers/org-lens-read-access.helper.ts`) has a third qualification, `employee-view`, tried **last**: after the roster (`org-grant`) and the authorizer (`auditor-entitlement`) have both answered cleanly and refused. A grant holder or LF staff therefore never reaches it and never sees less.

`OrgEmployeeViewService` (`server/services/org-employee-view.service.ts`) proves one thing for the **effective** user (the impersonation target, never the admin): a **verified** email address (`resolveVerifiedUserEmails`, strict) on a domain registered by an **active LF member** company.

CDP identity and work history are deliberately not part of it (product decision, 2026-11-19): the only proof of employment is the validated company email.

1. Each verified address is reduced to candidate domains: its own domain and each parent down to the registrable domain (`candidateMemberDomains`, `packages/shared/src/utils/email-domain.utils.ts`; `eng.acme.com` gives `eng.acme.com` and `acme.com`, never a public suffix such as `co.uk`). Personal mailbox providers (`gmail.com`, ...) contribute nothing.
2. The query service is asked for `b2b_org` records tagged `is_member:true` whose `primary_domain` or `domain_aliases` (the Salesforce `Domain_Alias__c` list, so `acme.co.uk`, `acme.com` and `acme.jp` all count) equals a candidate. Every returned record is re-checked against the candidates, because the index matches exactly and case-sensitively.
3. A request for `:orgUid` is eligible only when `:orgUid` is one of those companies. The company is whichever one the email names; editing the URL opens nothing. With no `:orgUid` (role-grants, selector) the first company in a stable order (name, then uid) is used. The website host is never a domain.

The company lookup uses the BFF's machine token (`generateM2MToken`), scoped to that one call: the caller was just refused `b2b_org#auditor`, which the query service applies per row, so their own token would see no company. It runs only for the effective user's own verified addresses, and only a record's id, name, slug and domains are read. Anything unproven is a denial (403). A lookup that **fails** (email lookup, query service, token, auth-service) is a 503 `ROLE_GRANTS_UNAVAILABLE`, never "not an employee". Verdicts are held 60 s per caller and company so a page's parallel requests cost one lookup; a failure is never kept.

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

`GET /api/orgs/me/role-grants` carries `employeeView?: { orgUid, orgName, orgSlug? }`, computed only for a caller with no grant and not staff. It is looked up for every grant-less, non-staff caller on a clean roster (no affiliation or employer pre-filter, so LF contractors take the same path), in parallel with the CLA-manager and affiliation lookups. `OrgRoleGrantsService.employeeViewOrgUid` holds it. `OrgLensViewModeService` answers `viewMode()` / `isEmployeeView()` for the selected company (`modeFor(uid)` for others); a real grant or staff always wins. The selector lists the company (`OrgItem.employeeView`), `/api/orgs/resolve/:segment` resolves its address (`OrgResolveResponse.employeeView`), and the empty state opens the lens instead of "no company linked". The client is UX only: the server refuses and redacts regardless.

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
