<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The program list and the program page (header, tab counts and its tabs) read the mentorship service (see [Program list sourcing](#program-list-sourcing) and [Program page sourcing](#program-page-sourcing)). The program page reads no mock data. The Enroll form's name check and project picker are live (see [Enroll lookups](#enroll-lookups)). Application decisions on Current Mentees (accept, decline, withdraw, graduate, decline by term), the reviewer note and the Mentors tab's Invite, Accept, Decline, Revoke invite and Remove write through the mentorship service (see [Application decisions](#application-decisions), [Reviewer note](#reviewer-note), [Mentor invite](#mentor-invite) and [Mentor status](#mentor-status)). Create task, Edit and the task status select use the task routes the mentor page shares (see [Task writes](#task-writes)). The Terms tab's create, edit, close, re-open and delete write through it too (see [Term writes](#term-writes)). The Enroll wizard creates the program and then uploads its logo (see [Program create and logo upload](#program-create-and-logo-upload) and [Wizard create flow](#wizard-create-flow)); a listed program still without a logo can get one from its card (see [Logo missing](#logo-missing)). With `?programId=` the wizard edits a program (see [Wizard edit flow](#wizard-edit-flow)).

## Routes

| Method | Path                                                                      | Controller method         | Page                                                  |
| ------ | ------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- |
| GET    | `/api/mentorship/admin/programs`                                          | `getPrograms`             | Admin program list, and the import picker on Enroll   |
| GET    | `/api/mentorship/admin/programs/:programId`                               | `getProgram`              | Admin program detail (header, tab counts, term list)  |
| GET    | `/api/mentorship/admin/programs/:programId/mentees`                       | `getProgramMentees`       | Current and Past Mentees tabs (one server-paged page) |
| GET    | `/api/mentorship/admin/programs/:programId/mentors`                       | `getProgramMentors`       | Mentors tab (one server-paged page of rows)           |
| POST   | `/api/mentorship/admin/programs/:programId/mentor-candidates`             | `getMentorCandidates`     | Mentors tab invite search (a read, body `{ search }`) |
| GET    | `/api/mentorship/admin/programs/:programId/terms`                         | `getProgramTerms`         | Terms tab (term rows with application counts)         |
| GET    | `/api/mentorship/admin/applications/:applicationId/tasks`                 | `getApplicationTasks`     | View Tasks on a Current Mentees row                   |
| PATCH  | `/api/mentorship/admin/applications/:applicationId/status`                | `updateApplicationStatus` | Accept, Decline and Graduate on a Current Mentees row |
| POST   | `/api/mentorship/admin/applications/:applicationId/withdraw`              | `withdrawApplication`     | Withdraw on a Current Mentees row                     |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/decline-pending` | `declinePendingForTerm`   | Decline by Term on the Current Mentees toolbar        |
| PUT    | `/api/mentorship/admin/applications/:applicationId/note`                  | `updateApplicationNote`   | Note on a Current Mentees row                         |
| POST   | `/api/mentorship/admin/programs/:programId/mentors`                       | `inviteProgramMentor`     | Invite on the Mentors tab toolbar                     |
| PATCH  | `/api/mentorship/admin/programs/:programId/mentors/:memberId`             | `updateProgramMentor`     | Accept, Decline, Revoke invite and Remove on a mentor |
| POST   | `/api/mentorship/admin/programs`                                          | `createProgram`           | Enroll wizard, create step                            |
| PATCH  | `/api/mentorship/admin/programs/:programId`                               | `updateProgram`           | Enroll wizard in edit mode, Update                    |
| POST   | `/api/mentorship/admin/programs/:programId/logo`                          | `uploadProgramLogo`       | Enroll wizard after create; Add logo on a list card   |
| GET    | `/api/mentorship/admin/programs/:programId/enroll-template`               | `getEnrollTemplate`       | Enroll wizard, import from an existing program        |
| POST   | `/api/mentorship/admin/programs/:programId/terms`                         | `createTerm`              | Add Term on the Terms tab                             |
| PATCH  | `/api/mentorship/admin/programs/:programId/terms/:termId`                 | `updateTerm`              | Edit on a term row                                    |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/close`           | `closeTerm`               | Close on a term row                                   |
| POST   | `/api/mentorship/admin/programs/:programId/terms/:termId/reopen`          | `reopenTerm`              | Re-Open on a term row                                 |
| DELETE | `/api/mentorship/admin/programs/:programId/terms/:termId`                 | `deleteTerm`              | Delete on a term row                                  |

`programId`, `applicationId`, `termId` and `memberId` must be UUIDs; anything else is a 400. The list accepts `search`, `status`, `offset` and `limit` (1–50, default 12). A malformed, blank, repeated or out-of-range `offset` or `limit` is a 400, and so is a repeated `search` or `status`. The mentees route requires `type` (`current` for open terms, `past` for closed ones), and accepts `status`, `termId`, `search`, `offset` and `limit` (1–50); a bad value is a 400. `status` must be one of `MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS[type]`: the display statuses on `current` (`applied`, `tasks-completed`, `accepted`, `declined`, `withdrawn`, `graduated`) and the wire statuses on `past` (`pending`, `accepted`, `declined`, `withdrawn`, `graduated`). The mentors route accepts `status` (`requested`, `pending`, `invited`, `active`, `declined`, `withdrawn`), `search`, `offset` and `limit` (1–50, default 10). The terms route accepts `offset` and `limit` (1–50, default 10). The mentor-candidates route takes `{ search }` in its body: a string of 2 to 254 characters (code points, as upstream counts runes) once trimmed (`MENTORSHIP_ADMIN_MENTOR_CANDIDATES_MIN_SEARCH_LENGTH`, `…_MAX_SEARCH_LENGTH`); anything else is a 400.

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
- The Current Mentees status filter lists the statuses its table shows (Applied, Tasks Completed, Accepted, Declined, Withdrawn, Graduated), so it splits `pending` the way the row badge does. The service maps the filter through `MENTORSHIP_ADMIN_MENTEE_STATUS_FILTER_TO_UPSTREAM`: `tasks-completed` goes upstream as `tasks_submitted` and the rest unchanged. Upstream's `applied` is a pending application with a prerequisite task still outstanding, and `tasks_submitted` one whose prerequisites are all submitted or complete (or that has none); neither matches `hold`. The badge (`mentorshipApplicantDisplayStatus`) reads a row with no tasks as Tasks Completed to match. It reads the row's `tasks_total` and `tasks_submitted`, which upstream counts over every task category rather than prerequisites alone, so a pending row with an outstanding non-prerequisite task can still disagree with the filter. Past Mentees still filters on the wire status.

The program detail's tabs: Current Mentees, Past Mentees, Mentors and Terms. A `pending-review` program has no mentees or mentors yet, so the page shows Terms only and opens on it (`getMentorshipProgramDetailTabs`); a refresh that hides the open tab moves to the first tab still shown. The page read still returns all four counts.

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

## Mentor invite

The Mentors tab invites anyone with an LF account as a mentor, whether or not they use Mentorship yet (linuxfoundation/lfx-mentorship#272, upstream linuxfoundation/lfx-mentorship#262). Upstream looks the account up and creates the Mentorship user, so the BFF never calls user-service or auth-service.

- **Search.** `POST …/mentor-candidates` with `{ search }` is a read, so it stays open while impersonating. It is a POST only so the search, which can be a full email, never lands in the request URL that every log line and Datadog RUM record. The BFF forwards the trimmed search to upstream `GET /programs/{id}/mentor-candidates?search=` with the caller's bearer token; upstream requires program writer and a published program (400 otherwise). Upstream escapes the search for its own name and LFID-prefix match and looks a full email up exactly through auth-service, so the BFF does not LIKE-escape it as it does the mentors list search. It answers at most 10 `{ lfid, name, avatarUrl? }`, never an email; a missing name falls back to the LFID. An unprovisioned caller gets `{ data: [] }`. Upstream's 400, 403 and 503 pass through with the query cut from the error's `path` (`withoutQueryInErrorPath`, shared with the name check), so a failed search does not log it. `otel.mjs` also creates no outgoing span for that upstream call (`MENTOR_CANDIDATES_UPSTREAM_PATH_PATTERN` in its `ignoreRequestHook`), since the Undici instrumentation exports `url.full` with the query.
- **Search field.** The toolbar's `lfx-autocomplete` searches after a 300 ms pause on at least 2 characters and lists each candidate's avatar, name and LFID. Below it, `MENTORSHIP_ADMIN_MENTOR_CANDIDATES_HELP_TEXT`. With no result, only a full email gets the account-creation hint (`…_NO_ACCOUNT_MESSAGE`); any other search can be a name or the LF username of someone who has an account, so it gets the neutral `…_NO_MATCH_MESSAGE`. A pasted search over 254 characters is not sent and shows `…_TOO_LONG_MESSAGE`, so a 400 from the BFF always means an unpublished program; a 400 shows `MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE` (the Mentors tab shows for hidden and rejected programs too), a 503 `…_UNAVAILABLE_MESSAGE` and any other failure `…_FAILED_MESSAGE`, inside the panel.
- **Invite.** `POST …/mentors` takes `{ lfid }` (trimmed, 1–`MENTORSHIP_ADMIN_MENTOR_INVITE_LFID_MAX_LENGTH`; anything else is a 400), behind `blockDuringImpersonation`, and sends upstream `POST /programs/{id}/members` with `{ lfid, member_type: 'mentor' }`. Only the LFID is forwarded, never an email or user id. Upstream answers 201 with the member as `invited` and emails the invite; the BFF answers 204.
- Invite is enabled only once a candidate is picked, and shares the tab's one-write-at-a-time guard with the row actions. A success clears the field, toasts, reloads the page and refreshes the tab counts. A 409 (already invited or a mentor) shows `MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE`, clears the field and reloads; a 400 (an unpublished program), a 422 (no LF account) and a 503 (lookup down) show the search messages above and keep the pick for a retry; the impersonation 403 shows the server's text, and anything else `MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE`.
- The BFF's own logs carry the program and member ids and the result count only, never the search text or the LFID; the search is never in a URL the request logger records. The old mock invite pool (`GET /api/mentorship/invitable-users`) is removed.

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

## Task writes

Create task on an accepted Current Mentees row, and Edit and the status select on an expanded task row, write through `POST /api/mentorship/tasks` and `PATCH /api/mentorship/tasks/:taskId`, which the mentor program detail uses too. The contract, the toasts and the in-flight tracking are in [Mentorship Task Writes](./mentorship-tasks.md). What Current Mentees adds:

- The tab sends one application per create. While another write of the tab is in flight it shows "Please wait", opens no form and sends nothing, and `MentorshipTaskCreateService.isCreating(id)` keeps a mentee's form shut while a create that outlived an earlier tab is still running.
- A create that settles, created or not, reloads the current page and has the program page read its tab counts again, as every decision does: a failure may still have created the task, and its message sends the admin to the mentee's row. The tasks cache is cleared with the reload, so a row that was collapsed reads no tasks. A row that was expanded stays expanded and reads its tasks once, after the reload lands; every other row collapses.
- A saved task is written into that row's cached tasks (`patchSavedTask`), so an edit or status change reads no list again. It also moves the row's `tasksSubmitted` by the change in submitted or completed tasks, because Graduate's warning reads that count and a reload is not made. A save that lands while the row's tasks are cleared or being re-read after a table reload is dropped, since that read brings the newer tasks.

## Program list sourcing

`getPrograms` reads upstream `GET /mentorship/v1/me/programs` (lfx-mentorship#243) once, through `proxyMentorshipRequest`, with the caller's bearer token, so upstream decides what the caller may see:

- `search` is trimmed, cut to 100 characters, and its `\`, `%` and `_` are escaped. `status` is the chosen status with `-` written as `_`. `limit` is at most 50 here and `offset` is passed through. No `limit` above the upstream maximum is ever sent.
- Upstream searches the program and project names, filters by status, sorts by name then id, pages, and returns each row with its latest open term (else the latest closed one), its counts and `admin_status`. The BFF maps each row and returns upstream's `meta.total`.
- On a caller's first visit upstream answers not-provisioned, so `proxyMentorshipRequest` provisions them (`PUT /me`) and retries, as on the mentor and mentee pages. A not-provisioned error that still reaches the service (while impersonating, which never provisions, or when the retry is refused too) gives an empty page and a warn log with no user identifiers. Any other error propagates, and the page shows its failed-load state with Retry.
- Upstream lists only direct `program_admin` memberships. Admins who only inherit access from the project are not listed yet.
- The list now carries upstream program ids, while the program detail still resolves mock ids only, so opening a listed program shows the not-found state until the detail moves to the mentorship service (linuxfoundation/lfx-mentorship#233).
- The Enroll form's "import from program" picker lists every program the admin manages, with "None" first. It reads the list page by page at `MENTORSHIP_PROGRAMS_MAX_LIMIT` until `total` is reached or a page comes back empty. See [Import from an existing program](#import-from-an-existing-program).

### Status mapping

A program's status is one of `pending`, `published`, `rejected` or `hidden`. Create leaves it `pending`; from there it moves to `published`, `rejected` or `hidden`, and a `published` program can later be `hidden`. There is no submit step.

Upstream works out `admin_status` from the program status and its terms. The BFF renames it (`_` to `-`):

| Upstream `admin_status` | Shown as       | Upstream program status                         |
| ----------------------- | -------------- | ----------------------------------------------- |
| `pending_review`        | Pending Review | `pending`                                       |
| `open`                  | Open           | `published` with an open term, or with no terms |
| `completed`             | Completed      | `published` with only closed terms              |
| `rejected`              | Rejected       | `rejected`                                      |
| `hidden`                | Hidden         | `hidden`                                        |

An unrecognised `admin_status` is shown as Pending Review and logged (program id and value only). The program header reads the program status itself (`MENTORSHIP_ADMIN_UNPUBLISHED_PROGRAM_STATUS`: `pending`, `rejected`, `hidden`); any other unpublished value is shown as Pending Review and logged the same way.

## Program create and logo upload

Two writes behind the Enroll wizard, each behind `blockDuringImpersonation` and with the caller's bearer token through `proxyMentorshipRequest`, so a first-time caller is provisioned and retried.

- `POST /api/mentorship/admin/programs` takes `MentorshipEnrollCreateRequest` (camelCase) and answers 201 with `{ id, slug, status }`. `parseMentorshipEnrollCreateRequest` in `mentorship-enroll.helper.ts` rebuilds the body from known keys only and answers 400 on the failing field: a UUID `projectId`, non-empty `projectSlug`, `projectName`, `name`, `description` and `repositoryUrl`, a non-empty `skills` list, 1–`MENTORSHIP_MAX_OPEN_TERMS` terms with five date and name fields, a `prerequisites` list whose `required` and `requireFile` are booleans when sent (left out means `false`) and whose `description` and `dueDate` are text when sent (left out or `null` means empty), and `termsAccepted: true`. A prerequisite's `required` means the admin picked it; upstream saves only picked ones. The dates are date-only `YYYY-MM-DD` and go upstream as sent: the wizard sends a term's `endDate` as the last day of its end month and folds a coding challenge's URL into the prerequisite description, since upstream has no field for it. A field inside a list is named by its index (`terms[1].startDate`, `prerequisites[0].name`). Every text field but a prerequisite description is trimmed, and the optional ones are kept only when not blank. The optional `industry` holds the wizard's Technologies as one string joined with a comma and a space; upstream keeps it apart from `skills`. `logo_url`, `logoUrl`, `status`, a term `id` and `logoFileName` are never forwarded.
- Upstream `POST /mentorship/v1/programs` leaves the program `pending`, which is "in review". There is no submit route and no publish call, so creating the program is what sends it to review; a reviewer then publishes, rejects or hides it. `slug` falls back to the id when upstream returns none.
- `POST /api/mentorship/admin/programs/:programId/logo` takes the raw file as the body with `Content-Type: image/png` or `image/jpeg` (`MENTORSHIP_ENROLL_LOGO_MIME_TYPES`) and answers 201 with `{ logoUrl }`, upstream's `public_url`. The BFF forwards the buffer and its content type to `POST /mentorship/v1/programs/{id}/logo-upload`. The wizard calls it after create, with the new program id, and then keeps the returned URL.
- `express.raw` runs on this route only, limited to `MENTORSHIP_ENROLL_LOGO_MAX_BYTES`. A larger body is a 413 (`PAYLOAD_TOO_LARGE`), converted from the parser's `entity.too.large` before the error handler flattens it to a 500. `express.raw` skips a type that is not on the list, so the controller answers 415 (`UNSUPPORTED_MEDIA_TYPE`) for it first and 400 on the `logo` field for an empty body.
- Logs carry the program id, status, term count, size in bytes and content type only, never a name, description, URL or file name.
- **Known gaps.** A dev environment without object storage answers the logo upload with a 503. A user who has just created a program can get a 403 on the upload until the permission grant lands; the app service's `uploadProgramLogo` retries that 403 up to 3 times, after 1, 2 and 4 seconds (see [Wizard create flow](#wizard-create-flow)). The create call is never retried. Upstream stores the date-only term dates at 00:00 UTC, refuses a term whose application window is a single day (application end must fall strictly after application start, and before the term starts), and drops any prerequisite sent with `required: false` without an error; the BFF passes all three through unchecked, so the wizard has to match them. The wizard's term dialog and setup step both refuse those two application windows (`getMentorshipEnrollTermDateErrors`); the program-detail Terms tab edits through a separate BFF route and keeps its own date rules.

## Import from an existing program

`GET /api/mentorship/admin/programs/:programId/enroll-template` is a read, so `blockDuringImpersonation` does not apply. It validates `programId` as a UUID (400 otherwise) and forwards to upstream `GET /mentorship/v1/programs/{id}/enroll-template` with the caller's bearer token through `proxyMentorshipRequest`, so upstream decides whether the caller may read that program (403 and 404 reach the wizard as they are). The source program is never written.

- Upstream answers `{ program, skills, prerequisites }`. `program` is snake_case. `skills` is always sent, possibly empty, and `prerequisites` is left out when empty. `prerequisites` is the program's stored task templates as they are, so its keys are camelCase (`submitFile`, `dueDate`).
- `toMentorshipEnrollImport` in `mentorship-enroll.helper.ts` maps the answer to `MentorshipEnrollImport`: text fields default to an empty string, and `project` is `null` unless the template carries a project uid, name and slug (create needs all three, so the admin picks the project otherwise).
- Technologies come from `program.industry`, a comma-separated string: split, trimmed, blanks dropped, and repeats removed ignoring case (the first spelling wins). This is the same field the create route writes.
- The BFF maps each prerequisite to a custom one: `required: true`, `requireFile` when upstream's `submitFile` is not blank, and `dueDate` kept only when set. Ids are `imported-<index>`.
- `formFromMentorshipEnrollImport` then lays them over the standard list. An item selects a standard row only when it matches that row as create sends it: the same name (ignoring case), description and file requirement, and no due date. The Coding Challenge is compared without the `Challenge:` line that create appended to its description, and gets that URL back (only the description's last line is checked). A standard row's text, file requirement and due date cannot be edited, so every other item, including a standard one the program changed, stays custom with its stored values. The standard rows the program did not use stay unselected.
- Terms and the logo are not copied, and `termsAccepted` is not set. `formFromMentorshipEnrollImport` gives the new form one default term and no logo. The template's `logo_url` comes back as `logoUrl` (`''` when none) for the edit wizard only.
- Logs carry the program id and the prerequisite count only, never a name, description, URL or skill.

In the wizard, picking a program reads its template (a newer pick drops the read of an older one), fills the form, clears any logo the admin had picked, and sets the project picker's value to the template's project even when the picker has not loaded it. A failed read shows `MENTORSHIP_ENROLL_IMPORT_FAILED` under the select, puts the select back to "None" and leaves the rest of the form as it was, so enrolling from scratch still works. Leaving the step before the read returns cancels it and puts the select back to "None" too. Picking "None" resets the form. If any page of the program list fails, the select offers only "None" and shows `MENTORSHIP_ENROLL_IMPORT_LIST_FAILED` under it, so an empty list does not read as having no programs.

## Wizard create flow

`EnrollProgramComponent` sends the two writes above in order: create, then the logo. There is no submit step, so a created program is already `pending` (in review). The wizard's `submitPhase` tracks those two requests only; it is not a program status.

- **Request mapping.** `toMentorshipEnrollCreateRequest` (`@lfx-one/shared/utils`) builds the body from the form and the picked `MentorshipLfProject`. It trims text, leaves out empty optional fields, de-duplicates Technologies and Skills, sets a term's `endDate` to the last day of its end month, and appends a coding challenge's URL to its prerequisite description as `Challenge: <url>`.

  | Form field   | Request field                             | Mapping                                                |
  | ------------ | ----------------------------------------- | ------------------------------------------------------ |
  | Technologies | `industry`                                | de-duplicated, joined with `', '`; left out when empty |
  | Skills       | `skills`                                  | de-duplicated                                          |
  | Project      | `projectId`, `projectSlug`, `projectName` | from the picked project                                |

- **Before create.** Submit checks every step again, since an earlier step's dates can pass while the admin is on a later one, and returns the admin to the first step that fails. A project id the picker never resolved to a project is a project-field error. `getMentorshipEnrollLogoError` refuses a logo whose name or `File.type` is not PNG or JPEG (an empty type included, since the upload sends `type` as its Content-Type), an empty file, and one over `MENTORSHIP_ENROLL_LOGO_MAX_BYTES`.
- **State.** `submitPhase` runs `idle → creating → uploading-logo → done`, or `failed` from either write. The wizard keeps the created `{ id, slug, status }`, so a retry skips a create that already succeeded, and it keeps the `File` so a retry resends the logo. Next shows a busy button, and a second click while a write is in flight is ignored. The answers lock when the create is sent, so what is saved is what is shown.
- **Create errors.** A 409 puts `MENTORSHIP_ENROLL_NAME_TAKEN` on the name field and returns the admin to the details step. A 403 with `MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE` shows the server-authored message; any other failure shows `MENTORSHIP_ENROLL_SUBMIT_FAILED`. The answers unlock again, and upstream error text is never shown.
- **Logo errors (partial save).** Once the create succeeds the answers are locked and Back is off. If the logo upload then fails, the program exists without a logo, so the wizard stays on the last step with a banner and a Retry button. A 413, 415 or 400 and a 503 add a field error beside the banner (`MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS`). The banner also carries its own file input; a valid file replaces the logo for the next Retry.
- **Retries.** `uploadProgramLogo` retries a 403 up to 3 times (1, 2 and 4 seconds, `MENTORSHIP_ENROLL_WRITE_RETRY_DELAYS_MS`) unless it is the impersonation read-only 403, and any other failure once after 1 second. A 400, 401, 413 or 415 is not retried: the file or the sign-in was refused (`MENTORSHIP_ENROLL_LOGO_NO_RETRY_STATUSES`). The submit is torn down if the wizard is destroyed.
- **Leaving.** The `admin/enroll` route has a `canDeactivate` that calls the component's `canLeave()`. Cancel and "My Programs" only navigate, so the guard decides once: it blocks the navigation while a write is in flight, then asks with the "Logo missing" prompt after a partial save, with the cancel prompt when answers would be lost, and not at all once the submit is done.

## Logo missing

A program whose logo upload failed after create is already in review without a logo. The program list lets the admin add the logo from its card, with no new status and no new route.

- `mapMentorshipAdminProgram` sets `logoMissing` on a list row when the raw upstream `status` (not `admin_status`) is `pending` or `published` (`MENTORSHIP_PROGRAM_LOGO_HINT_STATUSES`) and the row has no `logo_url`. A reviewer can publish such a program before the logo is added, so a published program keeps the hint; a `rejected`, `hidden` or any other program gets none. The program header mapper does not set it.
- The card shows "Logo missing" and an "Add logo" button that opens a hidden PNG/JPEG file input. `getMentorshipEnrollLogoError` checks the file first; a refused file is a toast and nothing is sent. The hint row sits below the card's clickable row, not inside it, so the button is never nested in the card's own button and never opens the program.
- The upload reuses `POST /api/mentorship/admin/programs/:programId/logo` and nothing else (no submit or other write). The card calls `uploadProgramLogo(id, file, false)`: the one automatic retry for a temporary failure applies, but not the 403 back-off, since the program was created earlier and a 403 is a real refusal.
- The button shows on every card with the hint, because the list carries no per-program permission; upstream decides. A 403 toasts "You don't have permission to change this program's logo." (the impersonation read-only 403 shows the server's text instead). 413, 415/400 and 503 toast the wizard's logo messages (`MENTORSHIP_ENROLL_LOGO_FAILURE_FIELD_ERRORS`); anything else toasts `MENTORSHIP_ENROLL_LOGO_NOT_UPLOADED`. A failure leaves the card as it was.
- On success the card toasts "Logo added." and emits `changed`; `ProgramsListComponent` passes it up and the admin page reads the first page again with the filters last applied (the same path as Retry), so the hint goes once upstream has the logo. That read replaces every page loaded with Load more, so after adding a logo on a later page the list is back to its first page, and an upload still running on a card that is no longer listed is cancelled without a toast.

## Wizard edit flow

The program page's Edit Program opens `/mentorship/admin/enroll?programId=<id>` (linuxfoundation/lfx-mentorship#265). With `programId` the wizard edits that program: the title is "Edit program", the last button is "Update", Import and the terms acknowledgement are left out, and the back link returns to the program.

- **Load.** The wizard reads the enroll template and every term (`getProgramTerms`, page by page at `MENTORSHIP_ADMIN_MANAGEMENT_MAX_LIMIT`). `formFromMentorshipEnrollEdit` fills the form like import does, plus the open terms (`toMentorshipEnrollTerm` moves both term dates to the first of their month, as the term dialog picks months), the current logo as the preview, and `termsAccepted: true`. Closed terms are listed read-only on the setup step. A failed read shows `MENTORSHIP_ENROLL_EDIT_LOAD_FAILED` with Retry.
- **Validation.** `getMentorshipEnrollStepErrors` takes the loaded program as an `edit` baseline. The logo is optional. A program that had open terms keeps at least one (upstream takes 1 to `MENTORSHIP_MAX_OPEN_TERMS` when terms are sent), while one with only closed terms may stay without. A saved term left unchanged skips the date rules, and a term date or custom prerequisite due date the program already had stays valid while unchanged, even once it has passed. The name check sends `excludeProgramId`, which the BFF forwards as upstream's `exclude_program_id`, so the program's own name reads as available.
- **Update.** One click sends `PATCH /api/mentorship/admin/programs/:programId`, then the logo upload if a new file was picked (with the 403 back-off off, since the program already exists). The PATCH body is `MentorshipEnrollUpdateRequest`: the create body's program fields, without `termsAccepted`, plus `terms`, the program's full set of open terms. `toMentorshipEnrollUpdateRequest` gives a saved term its upstream `id` and sends a term the admin added without one; with no open terms, `terms` is left out. The wizard shows term dates on the first of their month, so it keeps each saved term's stored dates beside it (`MentorshipEnrollSavedTerm`) and sends those back unchanged while the admin leaves the term's dates alone: editing anything else never moves a stored mid-month start or end. Likewise, while the project is the program's own, the wizard sends the project as loaded with its stored slug, name and logo: the picker can swap in its own row for the same project without a logo, and a blank `project_logo_url` would clear it. `parseMentorshipEnrollUpdateRequest` checks it with the create field rules, 1 to `MENTORSHIP_MAX_OPEN_TERMS` terms and a UUID `id` when present. `toMentorshipUpstreamProgramUpdate` sends it to upstream `PATCH /mentorship/v1/programs/{id}`, a snake_case partial merge:
  - blank optional fields go as `''` so they clear;
  - prerequisites become `task_templates` the way create converts them (picked ones only, `submitFile: 'required' | null`);
  - `skills` replaces the program's whole skill set, and the four project fields move it to the picked project, a blank `project_logo_url` clearing the project logo (linuxfoundation/lfx-mentorship#266);
  - `terms` replaces the open terms in the same transaction (linuxfoundation/lfx-mentorship#268): an entry with an `id` changes that term, one without is created, and an open term left out is deleted. Closed terms are never sent and stay as they are. The dates go as UTC instants (`toMentorshipUpstreamTermDates`, shared with the [term routes](#term-writes)), each end as the end of its day. The update sends the end date as given, while the term routes first move it to the last day of its month.

  Upstream leaves the program's status as it is. Its update does not check that the name is free, so before the PATCH the BFF runs the name-availability check with `exclude_program_id` set to the program, and answers 409 (`MENTORSHIP_PROGRAM_NAME_TAKEN_ERROR_CODE`) with no write when another program has the name.

- **Errors.** A failed write unlocks the answers. A 409 with the name-taken code returns the admin to the name field, as on create. Upstream's other 409 (an open term left out still has applications) saves nothing, so the wizard puts the saved terms the admin removed back in the list and shows `MENTORSHIP_ENROLL_TERM_DELETE_CONFLICT`. A failed logo upload shows `MENTORSHIP_ENROLL_EDIT_LOGO_NOT_UPLOADED`, and anything else `MENTORSHIP_ENROLL_UPDATE_FAILED`. Update runs the sequence again.
- **Retry without duplicates.** After an update that was saved, or may have been (no answer or a 5xx), the next Update first reads the terms again: the saved terms become what upstream holds, and a term the admin added takes the id of an open term upstream holds with the same name and dates. A retry then changes that term rather than creating it twice.
- **Leaving.** Leaving asks ("Discard changes") only when the answers differ from the loaded program, or a picked logo is not uploaded yet. Once the PATCH succeeds its answers count as saved, so a failed logo upload only leaves the logo to ask about.
- **Known gaps.** The BFF's name check and the PATCH are two calls, so two updates at once can still save the same name; only an upstream check would close that. Upstream authorizes the update against the program alone, not the project it moves to.

## Enroll lookups

Two read routes under `/api/mentorship` feed the Enroll details step. Neither blocks impersonation, and both use the caller's bearer token.

- `GET /api/mentorship/programs/name-available?name=&excludeProgramId=` trims `name` (blank, or longer than `MENTORSHIP_ENROLL_NAME_MAX`, is a 400), takes an optional UUID `excludeProgramId` (anything else is a 400) that it forwards as `exclude_program_id`, and calls upstream `GET /mentorship/v1/programs/name-availability` through `proxyMentorshipRequest`, so a first-time caller is provisioned and retried. It returns upstream's `{ available }`; an upstream error propagates and the form shows its "could not check" state. No logger call carries the name, and a failed check's error has the query cut from its upstream `path` before the error handler logs it. The request log still records the BFF URL, query string included, as it does for every route.
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

The Enroll form's lookups (program name availability, LF projects, CII badge) stay in the shared `MentorshipService`, not the admin one.

## Shared mappers

`apps/lfx-one/src/server/helpers/mentorship-program-application.helper.ts` maps an upstream task and an upstream application row to the detail-row shapes. The mentor program detail and the admin Current Mentees tab use it. The caller passes the application status map, because the two surfaces show some upstream statuses differently (the mentor map shows `hold` as `pending`).

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- The program list, the program page, the mentees page and the tasks read forward the caller's bearer token, so upstream enforces admin access (a 403 stays a 403). The mentors and terms reads do the same.
- The read routes stay available while impersonating. The write routes take `blockDuringImpersonation` (see [Impersonation](./impersonation.md)).
- The app service lets every failure reach the page (it logs status and statusText only). The page shows no-access for a 403, not-found for a 404, and an inline error with Retry otherwise; the mentees and tasks reads have their own inline error with Retry.
- The admin code's own log metadata carries ids, counts, flags and the status filter, never the `search` text, names or emails. The request URL, query string included, is still logged by the shared request serializer and kept on upstream errors, as on every route.
