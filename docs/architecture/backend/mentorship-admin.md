<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The program list and the program page (header, tab counts and all four tabs) read the mentorship service (see [Program list sourcing](#program-list-sourcing) and [Program page sourcing](#program-page-sourcing)). The program page reads no mock data; the Mentors tab's invite picker still does (see [Program list sourcing](#program-list-sourcing)). The Enroll form's name check and project picker are live (see [Enroll lookups](#enroll-lookups)). Application decisions on Current Mentees (accept, decline, withdraw, graduate, decline by term), the reviewer note, Create task and the Mentors tab's Accept, Decline, Revoke invite and Remove write through the mentorship service (see [Application decisions](#application-decisions), [Reviewer note](#reviewer-note), [Create task](#create-task) and [Mentor status](#mentor-status)). The Terms tab's create, edit, close, re-open and delete write through it too (see [Term writes](#term-writes)). The Enroll wizard's create and logo upload routes are in place, with no UI on them yet (see [Program create and logo upload](#program-create-and-logo-upload)). Mentor invite stays a "coming soon" stub until its PR.

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
| POST   | `/api/mentorship/admin/tasks`                                             | `createTasks`             | Create task on an accepted Current Mentees row        |
| PATCH  | `/api/mentorship/admin/tasks/:taskId`                                     | `updateTask`              | Edit and the status select on an expanded task row    |
| PATCH  | `/api/mentorship/admin/programs/:programId/mentors/:memberId`             | `updateProgramMentor`     | Accept, Decline, Revoke invite and Remove on a mentor |
| POST   | `/api/mentorship/admin/programs`                                          | `createProgram`           | Enroll wizard, create step                            |
| POST   | `/api/mentorship/admin/programs/:programId/logo`                          | `uploadProgramLogo`       | Enroll wizard, logo upload after create               |
| POST   | `/api/mentorship/admin/programs/:programId/terms`                         | `createTerm`              | Add Term on the Terms tab                             |
| PATCH  | `/api/mentorship/admin/programs/:programId/terms/:termId`                 | `updateTerm`              | Edit on a term row                                    |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/close`           | `closeTerm`               | Close on a term row                                   |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/reopen`          | `reopenTerm`              | Re-Open on a term row                                 |
| DELETE | `/api/mentorship/admin/programs/:programId/terms/:termId`                 | `deleteTerm`              | Delete on a term row                                  |

`programId`, `applicationId`, `termId` and `memberId` must be UUIDs; anything else is a 400. The list accepts `search`, `status`, `offset` and `limit` (1–50, default 12). A malformed, blank, repeated or out-of-range `offset` or `limit` is a 400, and so is a repeated `search` or `status`. The mentees route requires `type` (`current` for open terms, `past` for closed ones), and accepts `status`, `termId`, `search`, `offset` and `limit` (1–50); a bad value is a 400. The mentors route accepts `status` (`requested`, `pending`, `invited`, `active`, `declined`, `withdrawn`), `search`, `offset` and `limit` (1–50, default 10). The terms route accepts `offset` and `limit` (1–50, default 10).

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

## Mentor status

`PATCH …/programs/:programId/mentors/:memberId` moves one mentor to a new status, behind `blockDuringImpersonation`, with the caller's bearer token so upstream decides who may change it.

- The body is `{ status }` and `status` must be `active`, `declined` or `withdrawn`; anything else, or a bad id, is a 400 before any upstream call. The BFF sends `PATCH /programs/{programId}/members/{memberId}` with `{ status }` and answers 204.
- The Mentors tab offers by status (`MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS`): `requested` and `pending` get Accept (`active`) and Decline (`declined`), `invited` gets Revoke invite (`declined`), `active` gets Remove (`withdrawn`), and `declined` and `withdrawn` get none. Every action confirms first.
- Upstream answers 409 for a transition the mentor's status does not allow. It passes through, and the tab reloads and shows `This mentor changed. The list has been refreshed.` Other failures show the generic message, and the impersonation 403 shows the server's text.
- A success toasts, reloads the page and has the program page read its tab counts again, through the same callback as the mentee decisions, so a write that lands after a tab switch still refreshes the counts.
- Logs carry the program and member ids and the status only, never names or emails.
- **Known gap: no Delete.** Upstream's `DELETE /programs/{programId}/members/{memberId}` only sets `withdrawn`, and only from `active`, so it adds nothing over Remove. The tab has no Delete action and the BFF has no delete route. A hard delete (US7 scenario 4) needs an upstream change first.

## Term writes

Create, edit, close, re-open and delete a term, each behind `blockDuringImpersonation` and with the caller's bearer token.

- Create and edit take `{ name, startDate, endDate, applicationStartDate, applicationEndDate }` (`YYYY-MM-DD`). The name is trimmed and 1–50 characters; each date must be a real calendar date. The order follows upstream: application end on or after application start (a one-day window is valid), start after application end, end on or after start (a one-month term is valid). Anything else, or a bad id, is a 400 before any upstream call (`parseMentorshipAdminTermInput`).
- The BFF sends upstream RFC 3339 timestamps in UTC: each date as the start of its day (`YYYY-MM-DDT00:00:00Z`), except `application_end_date`, which goes as the last millisecond of its day (`YYYY-MM-DDT23:59:59.999Z`) so the term takes applications through that whole date, and `end_date_time`, which goes as the end of the last day of its month (`2026-12-01` → `2026-12-31T23:59:59.999Z`): the term dialog picks months, and the UI treats a term as running through its end month, so upstream's close/re-open/edit checks agree with it. The writes are `POST /programs/{programId}/terms` (always `status: open`) and `PATCH …/terms/{termId}`. Create answers 201 and edit 200, each with the term row (zero application counts). Close (`POST …/close`), re-open (`POST …/reopen`) and delete (`DELETE`) answer 204.
- **Four open terms.** Create and re-open first read the program's open terms (`limit=4`) and refuse with a 409 and `MENTORSHIP_MAX_OPEN_TERMS_MESSAGE` at four or more, without any write call. Upstream enforces the limit as well.
- Upstream answers 409 when a term to close still has accepted applications and when a term to delete has applications. It passes through, the tab shows the server's reason, reads the terms again and has the program page read its tab counts again.
- A success toasts, reloads the terms and refreshes the counts, so both mentee tabs and the Terms count follow the change. The tab sends one write at a time.
- Logs carry the program and term ids only, never the term name.

## Reviewer note

`PUT …/note` saves the one shared reviewer note of an application, behind `blockDuringImpersonation`, with the caller's bearer token.

- The body is `{ note }`: a string, trimmed here, at most `MENTORSHIP_MENTEE_NOTE_MAX` (2000) characters. An empty note clears it. A missing body, a non-string `note`, an over-long note or a bad `applicationId` is a 400 before any upstream call.
- The BFF sends `PUT /applications/{id}/note` with `{ reviewer_note }` and answers 204.
- The body check and the upstream save live in `server/helpers/mentorship-application-note.helper.ts`, which the mentor note route (see [Mentorship mentor](./mentorship-mentor.md#reviewer-notes)) uses too, so the two routes cannot drift apart.
- Upstream 403 and 404 (and 409) pass through unchanged. The page shows its own message for a 403 and a 404, the server's message for the impersonation 403, and a generic one otherwise, and leaves the row's note as it was.
- The note dialog is the same one the mentor surface uses, and the Current Mentees tab owns it. A save of an unchanged note sends nothing. A note changes no tab count, so the page does not reload its counts.
- The save's state lives in `AdminNoteSaveService`, not the tab, because switching tabs destroys the tab. The save is not tied to the tab, so it and its toast finish if the admin leaves first. While it is in flight `isSaving(id)` keeps that row's dialog shut, in a tab rebuilt by a switch too. When it succeeds `saved$` announces it, and whichever Current Mentees tab is on screen writes the note into its row; a tab built later reads the rows again, saved note included. Each save also bumps a version, and a page read takes the version as it starts (`currentVersion()`) and lays `notesSavedSince(version)` over its answer, so a read that started before the save cannot replace the saved note with the older one.
- Logs carry the application id and the note's length only, never its text.

## Create task

`POST …/tasks` gives accepted mentees a task, behind `blockDuringImpersonation`, with the caller's bearer token so upstream decides who may create.

- The contract is the mentor task create's: the body is `{ applicationIds, name, description, dueDate?, requiresFileSubmission? }` and the answer is 200 `{ created, failed }`. The body check is `parseMentorshipMentorTaskCreateRequest` and the upstream work is `createMentorshipMenteeTasks`, both in `mentorship-mentor-task.helper.ts` and shared with the mentor route (see [Mentorship mentor](./mentorship-mentor.md)), so the two routes cannot drift apart. Each route passes its own operation, so the admin create logs as `create_mentorship_admin_tasks`. The admin is the task's owner and author, and `requiresFileSubmission` maps to `submit_file`.
- Upstream does the admin check, and the application must be an accepted mentee: a non-accepted application is a 400 before any task is written. With one application the upstream error passes through (403, 404, 409); with several, at most `MENTORSHIP_MENTOR_TASK_CREATE_CONCURRENCY` (3) are created at once and the ones that failed are listed in `failed`. The Current Mentees tab sends one application per create.
- Upstream's create is not idempotent. A failure with no status of its own (a timeout, a 5xx) may still have created the task, so the page's message tells the admin to check the mentee's row rather than to retry. A 400, a 403 and a 404 get their own message, and the impersonation 403 shows the server's.
- A create that settles, created or not, reloads the current page and has the program page read its tab counts again, as every decision does: a failure may still have created the task, and its message sends the admin to the mentee's row. The tasks cache is cleared with the reload, so a row that was collapsed reads no tasks. A row that was expanded stays expanded and reads its tasks once, after the reload lands; every other row collapses.
- The create runs in `AdminTaskCreateService` and is not cancelled by the tab going away. While another write is in flight the tab shows "Please wait", opens no form and sends nothing. The service also tracks the mentees getting a task (`isCreating(id)`), so a tab rebuilt by a switch while a create is still running keeps that mentee's form shut and sends nothing for them.
- Logs carry the application count and the created and failed counts only, never the task's name or description.

## Edit task and set status

`PATCH …/tasks/:taskId` changes one task, behind `blockDuringImpersonation`, with the caller's bearer token so upstream decides who may edit. Upstream is `PATCH /mentorship/v1/tasks/{id}` (lfx-mentorship#227).

- The body is `MentorshipAdminTaskUpdate`: every field is optional and an absent one is left unchanged, but at least one is required. The status select sends `status` alone; the edit dialog sends only what it changed, diffed against the row by `buildMentorshipAdminTaskUpdate` in `@lfx-one/shared/utils`. The body check is `parseMentorshipAdminTaskUpdate` and the upstream body is `buildMentorshipUpstreamTaskUpdate`, both in `mentorship-admin-task.helper.ts`. `status` goes through `MENTORSHIP_ADMIN_TASK_STATUS_TO_UPSTREAM`, `requiresFileSubmission` maps to `submit_file` (`required`, or `''` to clear it) and an empty `dueDate` clears the due date.
- Upstream lets a status move to any other status. A task that requires a file cannot be Submitted without an uploaded file, whether it is moving to Submitted or gaining the file requirement, and upstream answers that with a 400. That 400 gets its own copy only for a change that can trip the guard (a move to Submitted or a change to the file requirement); any other 400 shows the generic copy. A 403 and a 404 each have their own copy, and any other failure shows the generic one. A failed change leaves the row as it was.
- The answer is 200 with the task as the row reads it. The Current Mentees tab writes it into that row's cached tasks (`patchSavedTask`), so an edit or status change reads no list again. It also moves the row's `tasksSubmitted` by the change in submitted or completed tasks, because Graduate's warning reads that count and a reload is not made.
- The save runs in `AdminTaskUpdateService`, which tracks the tasks being saved: a task with a change in flight takes no second change, and its select and Edit are disabled. The in-flight ids are a signal, so a panel rebuilt mid-save keeps both disabled and re-enables them when the save settles, whether it succeeded or failed. The save is not cancelled by a row collapsing, so it lands in the cache even if the panel was destroyed. One that lands while the row's tasks are cleared or being re-read after a table reload is dropped, since that read brings the newer tasks.
- Only the admin Current Mentees tab sets `editable` on the task panel. The mentor tabs use the same panel but have no BFF route, so they still show the "coming soon" toast.
- Logs carry the task id and the names of the fields changed, never the task's text.

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

## Program create and logo upload

Two writes behind the Enroll wizard, each behind `blockDuringImpersonation` and with the caller's bearer token through `proxyMentorshipRequest`, so a first-time caller is provisioned and retried.

- `POST /api/mentorship/admin/programs` takes `MentorshipEnrollCreateRequest` (camelCase) and answers 201 with `{ id, slug, status }`. `parseMentorshipEnrollCreateRequest` in `mentorship-enroll.helper.ts` rebuilds the body from known keys only and answers 400 on the failing field: a UUID `projectId`, non-empty `projectSlug`, `projectName`, `name`, `description` and `repositoryUrl`, a non-empty `skills` list, 1–`MENTORSHIP_MAX_OPEN_TERMS` terms with five date and name fields, a `prerequisites` list whose `required` and `requireFile` are booleans when sent (left out means `false`), and `termsAccepted: true`. A prerequisite's `required` means the admin picked it; upstream saves only picked ones. The dates are date-only `YYYY-MM-DD` and go upstream as sent: the wizard sends a term's `endDate` as the last day of its end month and folds a coding challenge's URL into the prerequisite description, since upstream has no field for it. A field inside a list is named by its index (`terms[1].startDate`, `prerequisites[0].name`). Every text field but a prerequisite description is trimmed, and the optional ones are kept only when not blank. The optional `industry` holds the wizard's Technologies as one string joined with `, `; upstream keeps it apart from `skills`. `logo_url`, `logoUrl`, `status`, a term `id` and `logoFileName` are never forwarded.
- Upstream `POST /mentorship/v1/programs` leaves the program `pending`, which is "in review". There is no submit route and no publish call, so creating the program is what sends it to review. `slug` falls back to the id when upstream returns none.
- `POST /api/mentorship/admin/programs/:programId/logo` takes the raw file as the body with `Content-Type: image/png` or `image/jpeg` (`MENTORSHIP_ENROLL_LOGO_MIME_TYPES`) and answers 201 with `{ logoUrl }`, upstream's `public_url`. The BFF forwards the buffer and its content type to `POST /mentorship/v1/programs/{id}/logo-upload`. The wizard calls it after create, with the new program id, and then keeps the returned URL.
- `express.raw` runs on this route only, limited to `MENTORSHIP_ENROLL_LOGO_MAX_BYTES`. A larger body is a 413 (`PAYLOAD_TOO_LARGE`), converted from the parser's `entity.too.large` before the error handler flattens it to a 500. `express.raw` skips a type that is not on the list, so the controller answers 415 (`UNSUPPORTED_MEDIA_TYPE`) for it first and 400 on the `logo` field for an empty body.
- Logs carry the program id, status, term count, size in bytes and content type only, never a name, description, URL or file name.
- **Known gaps.** A dev environment without object storage answers the logo upload with a 503. A user who has just created a program can get a 403 on the upload until the permission grant lands, which the wizard handles with one retry in a later PR. The app service has no retry on either call. Upstream stores the date-only term dates at 00:00 UTC, refuses a term whose application window is a single day (application end must fall strictly after application start, and before the term starts), and drops any prerequisite sent with `required: false` without an error; the BFF passes all three through unchecked, so the wizard has to match them.

## Enroll lookups

Two read routes under `/api/mentorship` feed the Enroll details step. Neither blocks impersonation, and both use the caller's bearer token.

- `GET /api/mentorship/programs/name-available?name=` trims `name` (blank, or longer than `MENTORSHIP_ENROLL_NAME_MAX`, is a 400) and calls upstream `GET /mentorship/v1/programs/name-availability` through `proxyMentorshipRequest`, so a first-time caller is provisioned and retried. It returns upstream's `{ available }`; an upstream error propagates and the form shows its "could not check" state. No logger call carries the name, and a failed check's error has the query cut from its upstream `path` before the error handler logs it. The request log still records the BFF URL, query string included, as it does for every route.
- `GET /api/mentorship/lf-projects?search=&page_token=&page_size=` is the picker's lazy-load source, on the standard cursor contract (see [Pagination](pagination.md)). It reads the query service directly (`GET /query/resources`, `type=project`, `page_size` defaults to `MENTORSHIP_LF_PROJECT_PAGE_SIZE`, held to 1–`MENTORSHIP_LF_PROJECT_MAX_LIMIT`; `search` is cut to `MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH`): by name (`sort=name_asc`) when `search` is blank, so the picker has options before the user types, and by relevance (`name=`, `sort=best_match`) otherwise. The ROOT project is dropped. The query service can trim a page after cutting it (access filtering) and still return a `page_token`, so the BFF follows the token until it holds `page_size` projects or has spent `MENTORSHIP_LF_PROJECT_MAX_READS` reads, asking each read only for the slots still open so a page never exceeds `page_size`, then returns a `PaginatedResponse` (`{ data, page_token? }`) with the token it stopped at. A page can therefore be short (even empty) and still carry a cursor; `page_token` is left out only once the list is exhausted. A cursor that comes back unchanged also ends the list, since following it would only replay the page just read. Projects are mapped to `{ id: uid, name, slug, logoUrl? }`, with `logoUrl` left out when empty. Upstream mentorship has no project list, and create needs the project's uid, slug and name.

The details step keeps the chosen `MentorshipLfProject` in its `project` model, bound to the wizard's `selectedProject` signal, so no lookup table is needed. As the virtual scroller reaches the end of the loaded rows, the step requests the next page with the last `page_token`; while fewer than `MENTORSHIP_LF_PROJECT_PAGE_SIZE` projects are loaded, a page that still has a cursor is followed at once, since a short list may not fill the scroller enough to trigger a lazy load. That follow runs at most `MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS` times per search, because each BFF page can already cost several query-service reads; a caller who can see only a few projects narrows the list by typing a search rather than having the picker walk the whole catalog on open. A cursor that comes back the same as the one requested is treated as the end of the list, so neither that follow nor a scroll can replay the page. A failed page read shows "Could not load projects" with Try again under the picker instead of an empty list. A failed first page clears the list and its cursor and Try again rereads it; a failed later page keeps the list and its cursor, scrolling stops reading, and Try again asks for that page again. A new search starts again from the first page, and the empty message reads "Searching projects…" from the keystroke through the debounce, not "No results found". The select's own filter is turned off in effect: PrimeNG filters loaded options by label whenever the box holds text, even with `lazy` on, which would hide the aliases and name-token matches the query service returns, so the select filters on `MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD` (a field no option has) with `notEquals`, which matches every option. When the form's `projectId` changes to an id not yet loaded, `project` is cleared rather than left on the previous project, and is filled once that id appears in a loaded page. The picker reuses the mentor-picker dropdown fixes (`MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS`, a row-count scroll height, and clearing the filter when the overlay closes) so an empty or short list is not mis-sized.

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
