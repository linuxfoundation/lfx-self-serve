<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The program list and the program page's header, tab counts and Current Mentees tab read the mentorship service (see [Program list sourcing](#program-list-sourcing) and [Program page sourcing](#program-page-sourcing)). The Past Mentees, Mentors and Terms tabs still read mock data (`MOCK_MENTORSHIP_PROGRAM_LISTS`) until their own PR. Later PRs in the story replace the mocks one screen at a time.

## Routes

| Method | Path                                                      | Controller method     | Page                                                 |
| ------ | --------------------------------------------------------- | --------------------- | ---------------------------------------------------- |
| GET    | `/api/mentorship/admin/programs`                          | `getPrograms`         | Admin program list, and the import picker on Enroll  |
| GET    | `/api/mentorship/admin/programs/:programId`               | `getProgram`          | Admin program detail (header, tab counts, term list) |
| GET    | `/api/mentorship/admin/programs/:programId/mentees`       | `getProgramMentees`   | Current Mentees tab (one server-paged page of rows)  |
| GET    | `/api/mentorship/admin/applications/:applicationId/tasks` | `getApplicationTasks` | View Tasks on a Current Mentees row                  |

`programId` and `applicationId` must be UUIDs; anything else is a 400. The list accepts `search`, `status`, `offset` and `limit` (1–50, default 12). A malformed, blank, repeated or out-of-range `offset` or `limit` is a 400, and so is a repeated `search` or `status`. The mentees route requires `type`, and accepts `status`, `termId`, `search`, `offset` and `limit` (1–50); a bad value is a 400.

## Program page sourcing

`getProgramPage` runs five upstream reads with `Promise.allSettled`, all with the caller's bearer token:

| Read                                                   | Feeds                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `GET /programs/{id}/header`                            | The program. Required: a failure is rethrown (404 stays 404) |
| `GET /programs/{id}/management-summary`                | `pastMentees` and `terms` counts, and the status flags       |
| `GET /programs/{id}/applications?type=current&limit=1` | `currentMentees` (`meta.total`)                              |
| `GET /programs/{id}/member-management?limit=1`         | `mentors` (`meta.total`)                                     |
| `GET /programs/{id}/terms`, every page at `limit=100`  | The term options (open and closed, minus deleted)            |

- Upstream lets any program viewer read the header and the terms. The other three reads need a manager, so a 403 on any of them is rethrown and the page shows no-access.
- Any other failed count read gives `null`, which the header shows as `–`. A failed terms read gives `terms: []`.
- The header has no `admin_status`, so the page status is derived from the header `status` plus the summary's `has_open_term` and `has_closed_term`.
- `getProgramMentees` makes one upstream read of `GET /programs/{id}/applications` per call, sending `type`, `status`, `term` (the term id), `search`, `offset` and `limit` (at most 50). It never walks every page, and returns upstream's `meta.total` as `total`. `search` is escaped here (trimmed, cut to 100 characters, `\`, `%` and `_` escaped). An unprovisioned caller gets an empty page.
- `getApplicationTasks` reads `GET /applications/{id}/tasks` through `listAllMentorshipPages` (page size 100). Only the View Tasks click calls it. The page caches the result per application and clears the cache, collapsing every row, whenever the table reloads.
- The Current Mentees status filter lists the upstream statuses (Pending, Accepted, Declined, Withdrawn, Graduated), since it is sent upstream as `status`. The row badge still splits `pending` into Applied and Tasks Completed.

The program detail's tabs: Current Mentees, Past Mentees, Mentors and Terms. Until their own PR, `buildMentorshipProgramDetail` (shared utils) builds the Past Mentees, Mentors and Terms lists from the mock data.

## Program list sourcing

`getPrograms` reads upstream `GET /mentorship/v1/me/programs` (lfx-mentorship#243) once, through `proxyMentorshipRequest`, with the caller's bearer token, so upstream decides what the caller may see:

- `search` is trimmed, cut to 100 characters, and its `\`, `%` and `_` are escaped. `status` is the chosen status with `-` written as `_`. `limit` is at most 50 here and `offset` is passed through. No `limit` above the upstream maximum is ever sent.
- Upstream searches the program and project names, filters by status, sorts by name then id, pages, and returns each row with its latest open term (else the latest closed one), its counts and `admin_status`. The BFF maps each row and returns upstream's `meta.total`.
- On a caller's first visit upstream answers not-provisioned, so `proxyMentorshipRequest` provisions them (`PUT /me`) and retries, as on the mentor and mentee pages. A not-provisioned error that still reaches the service (while impersonating, which never provisions, or when the retry is refused too) gives an empty page and a warn log with no user identifiers. Any other error propagates, and the page shows its failed-load state with Retry.
- Upstream lists only direct `program_admin` memberships. Admins who only inherit access from the project are not listed yet.
- The list now carries upstream program ids, while the program detail still resolves mock ids only, so opening a listed program shows the not-found state until the detail moves to the mentorship service (linuxfoundation/lfx-mentorship#233).
- The Enroll form's "import from program" picker keeps only programs that have import details (`isMentorshipProgramImportable`). Those details are still keyed by mock ids, so the picker offers only "None" until import moves to the mentorship service.

### Status mapping

Upstream works out `admin_status` from the program status and its terms. The BFF renames it (`_` to `-`):

| Upstream `admin_status` | Shown as       | Upstream program status                         |
| ----------------------- | -------------- | ----------------------------------------------- |
| `pending_review`        | Pending Review | `draft`, `submitted`                            |
| `open`                  | Open           | `published` with an open term, or with no terms |
| `completed`             | Completed      | `published` with only closed terms              |
| `rejected`              | Rejected       | `rejected`                                      |
| `hidden`                | Hidden         | `archived`, `hidden`                            |

An unrecognised `admin_status` is shown as Pending Review and logged (program id and value only).

## Flow

```text
AdminComponent · ProgramDetailComponent · EnrollDetailsStepComponent
  → MentorshipAdminService (app)              GET /api/mentorship/admin/*
      → mentorship.route.ts                   router.use('/admin', adminRouter)
      → mentorship-admin.route.ts
      → MentorshipAdminController             401 with no signed-in user
      → MentorshipAdminService (server)       404 for an unknown program
  ← JSON
```

| Layer          | File                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Shared types   | `packages/shared/src/interfaces/mentorship-admin.interface.ts`, exported through the interfaces barrel   |
| Router         | `apps/lfx-one/src/server/routes/mentorship-admin.route.ts`, mounted at `/admin` by `mentorship.route.ts` |
| Controller     | `apps/lfx-one/src/server/controllers/mentorship-admin.controller.ts`                                     |
| Server service | `apps/lfx-one/src/server/services/mentorship-admin.service.ts`                                           |
| App service    | `apps/lfx-one/src/app/shared/services/mentorship-admin.service.ts`                                       |

The Enroll form's lookups (program name availability, LF projects, invitable users, CII badge) stay in the shared `MentorshipService`, not the admin one.

## Shared mappers

`apps/lfx-one/src/server/helpers/mentorship-program-application.helper.ts` maps an upstream task and an upstream application row to the detail-row shapes. The mentor program detail and the admin Current Mentees tab use it. The caller passes the application status map, because the two surfaces show some upstream statuses differently (the mentor map shows `hold` as `pending`).

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- The program list, the program page, the mentees page and the tasks read forward the caller's bearer token, so upstream enforces admin access (a 403 stays a 403). A screen still on mock data (the Past Mentees, Mentors and Terms tabs) must forward the token, or add a BFF-side admin guard, with a 403 test, when it moves.
- The read routes stay available while impersonating. Admin write routes added later take `blockDuringImpersonation` (see [Impersonation](./impersonation.md)).
- The app service lets every failure reach the page (it logs status and statusText only). The page shows no-access for a 403, not-found for a 404, and an inline error with Retry otherwise; the mentees and tasks reads have their own inline error with Retry.
- The admin code's own log metadata carries ids, counts, flags and the status filter, never the `search` text, names or emails. The request URL, query string included, is still logged by the shared request serializer and kept on upstream errors, as on every route.
