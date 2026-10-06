<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The program list and the program page (header, tab counts and all four tabs) read the mentorship service (see [Program list sourcing](#program-list-sourcing) and [Program page sourcing](#program-page-sourcing)). The program page reads no mock data; the Enroll form's lookups and the Mentors tab's invite picker still do (see [Program list sourcing](#program-list-sourcing)). Application decisions on Current Mentees (accept, decline, withdraw, graduate, decline by term) and the reviewer note write through the mentorship service (see [Application decisions](#application-decisions) and [Reviewer note](#reviewer-note)). The other write actions (invite, remove, term create, edit, close, re-open, delete) stay "coming soon" stubs until their PRs.

## Routes

| Method | Path                                                                      | Controller method         | Page                                                  |
| ------ | ------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| GET    | `/api/mentorship/admin/programs`                                          | `getPrograms`             | Admin program list, and the import picker on Enroll   |
| GET    | `/api/mentorship/admin/programs/:programId`                               | `getProgram`              | Admin program detail (header, tab counts, term list)  |
| GET    | `/api/mentorship/admin/programs/:programId/mentees`                       | `getProgramMentees`       | Current and Past Mentees tabs (one server-paged page) |
| GET    | `/api/mentorship/admin/programs/:programId/mentors`                       | `getProgramMentors`       | Mentors tab (one server-paged page of rows)           |
| GET    | `/api/mentorship/admin/programs/:programId/terms`                         | `getProgramTerms`         | Terms tab (term rows with application counts)         |
| GET    | `/api/mentorship/admin/applications/:applicationId/tasks`                 | `getApplicationTasks`     | View Tasks on a Current Mentees row                   |
| PATCH  | `/api/mentorship/admin/applications/:applicationId/status`                | `updateApplicationStatus` | Accept, Decline and Graduate on a Current Mentees row |
| POST   | `/api/mentorship/admin/applications/:applicationId/withdraw`              | `withdrawApplication`     | Withdraw on a Current Mentees row                     |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/decline-pending` | `declinePendingForTerm`   | Decline by Term on the Current Mentees toolbar        |
| PUT    | `/api/mentorship/admin/applications/:applicationId/note`                  | `updateApplicationNote`   | Note on a Current Mentees row                         |

`programId`, `applicationId` and `termId` must be UUIDs; anything else is a 400. The list accepts `search`, `status`, `offset` and `limit` (1–50, default 12). A malformed, blank, repeated or out-of-range `offset` or `limit` is a 400, and so is a repeated `search` or `status`. The mentees route requires `type` (`current` for open terms, `past` for closed ones), and accepts `status`, `termId`, `search`, `offset` and `limit` (1–50); a bad value is a 400. The mentors route accepts `status` (`requested`, `pending`, `invited`, `active`, `declined`, `withdrawn`), `search`, `offset` and `limit` (1–50, default 10). The terms route accepts `offset` and `limit` (1–50, default 10).

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

The program detail's tabs: Current Mentees, Past Mentees, Mentors and Terms.

- **Past Mentees** reuses `getProgramMentees` with `type=past`: every application in a closed term, whatever its status. The tab is read-only (no tasks, notes or row actions).
- **Mentors** reads `GET /programs/{id}/member-management` with `status`, escaped `search`, `offset` and `limit` (at most 50). `member_type` is not sent: the upstream handler ignores it and lists mentors. Each row maps to `MentorshipProgramMentor`; `invitedOn` comes from the row's `created_on`, since upstream has no separate invitation date. Upstream status `active` stays `active`, and the older name `approved` maps to it too. A status the BFF does not know reads as `pending` and logs a warning with ids and the status only.
- **Terms** reads `GET /programs/{id}/term-management` and maps each row to `MentorshipProgramTermRow` (counts plus the term and application dates, `YYYY-MM-DD`). A term that is neither open nor closed is dropped. The tab reads every page at the upstream maximum (50), following `total` up to `MENTORSHIP_ADMIN_TERMS_MAX_PAGES`, so the open-term limit counts every term.
- An unprovisioned caller gets an empty `{ data: [], total: 0 }` on both new routes, as on the mentees route.

## Application decisions

Three write routes, each behind `blockDuringImpersonation` (a 403 with code `IMPERSONATION_READ_ONLY` before the controller runs), all with the caller's bearer token so upstream decides who may decide.

| Route                    | Upstream call                                                                | Answer                  |
| ------------------------ | ---------------------------------------------------------------------------- | ----------------------- |
| `PATCH …/status`         | `PATCH /applications/{id}/status` with `{status, attendance_type?}`          | 204                     |
| `POST …/withdraw`        | `GET /applications/{id}`, then `POST /applications/{id}/withdraw-for-mentee` | 204                     |
| `POST …/decline-pending` | `POST /programs/{programID}/terms/{termID}/applications/bulk-decline`        | 200 `{ declinedCount }` |

- The body of `PATCH …/status` is `{ status, attendanceType? }`. `status` must be `accepted`, `declined` or `graduated`, and an accept needs `attendanceType` (`full_time` or `part_time`); anything else is a 400 before any upstream call. Fields outside the contract are dropped, and `attendance_type` is sent upstream only with an accept. Upstream answers 200 with the application; the BFF discards it and answers 204.
- Withdraw has no status guard upstream, so the BFF reads the application first and answers 409 (`This application changed. The list has been refreshed.`) unless it is `pending`, `hold` or `accepted`. Nothing is written in that case.
- Upstream answers 409 for a transition the application's status does not allow and 422 when an accept targets a term that is no longer open. Both pass through unchanged, and the Current Mentees tab shows a message for each (a 409 also reloads the page); a 422 on any other decision gets the generic failure message.
- Graduate's task warning is computed in the browser from the row's counts, `max(tasksTotal - tasksSubmitted, 0)`. No task is read for it.
- Every decision reloads the current page, which also clears the loaded tasks and collapses the rows, and has the program page read its tab counts again without its loading state, so the open tab keeps its filters and page. A write is never cancelled by the tab going away; one that answers after the admin switched tabs still toasts and refreshes the counts, through a callback the page hands the tab, but reloads no table.
- Logs carry the application, program and term ids, the status and the declined count only, never names or emails.

## Reviewer note

`PUT …/note` saves the one shared reviewer note of an application, behind `blockDuringImpersonation`, with the caller's bearer token.

- The body is `{ note }`: a string, trimmed here, at most `MENTORSHIP_MENTEE_NOTE_MAX` (2000) characters. An empty note clears it. A missing body, a non-string `note`, an over-long note or a bad `applicationId` is a 400 before any upstream call.
- The BFF sends `PUT /applications/{id}/note` with `{ reviewer_note }` and answers 204.
- The body check and the upstream save live in `server/helpers/mentorship-application-note.helper.ts`, which the mentor note route (see [Mentorship mentor](./mentorship-mentor.md#reviewer-notes)) uses too, so the two routes cannot drift apart.
- Upstream 403 and 404 (and 409) pass through unchanged. The page shows its own message for a 403 and a 404, the server's message for the impersonation 403, and a generic one otherwise, and leaves the row's note as it was.
- The note dialog is the same one the mentor surface uses, and the Current Mentees tab owns it. A save of an unchanged note sends nothing. A note changes no tab count, so the page does not reload its counts.
- The save's state lives in `AdminNoteSaveService`, not the tab, because switching tabs destroys the tab. The save is not tied to the tab, so it and its toast finish if the admin leaves first. While it is in flight `isSaving(id)` keeps that row's dialog shut, in a tab rebuilt by a switch too. When it succeeds `saved$` announces it, and whichever Current Mentees tab is on screen writes the note into its row; a tab built later reads the rows again, saved note included. Each save also bumps a version, and a page read takes the version as it starts (`currentVersion()`) and lays `notesSavedSince(version)` over its answer, so a read that started before the save cannot replace the saved note with the older one.
- Logs carry the application id and the note's length only, never its text.

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
- The program list, the program page, the mentees page and the tasks read forward the caller's bearer token, so upstream enforces admin access (a 403 stays a 403). The mentors and terms reads do the same.
- The read routes stay available while impersonating. The write routes take `blockDuringImpersonation` (see [Impersonation](./impersonation.md)).
- The app service lets every failure reach the page (it logs status and statusText only). The page shows no-access for a 403, not-found for a 404, and an inline error with Retry otherwise; the mentees and tasks reads have their own inline error with Retry.
- The admin code's own log metadata carries ids, counts, flags and the status filter, never the `search` text, names or emails. The request URL, query string included, is still logged by the shared request serializer and kept on upstream errors, as on every route.
