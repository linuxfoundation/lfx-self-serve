<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Mentor BFF

The mentor pages under `/mentorship/mentor/*` read their data from the LFX One BFF's `/api/mentorship/mentor/*` routes. The mentor code has its own router, controller and services, separate from the admin and mentee code, so each mentor screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#206).

## Routes

| Method | Path                                                      | Controller method       | Page                                                                                     |
| ------ | --------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/mentorship/mentor/programs`                         | `getMentorPrograms`     | My Programs (`/mentorship/mentor/programs`)                                              |
| GET    | `/api/mentorship/mentor/programs/:programId`              | `getMentorProgram`      | Program detail (`/mentorship/mentor/programs/:programId`)                                |
| GET    | `/api/mentorship/mentor/profile`                          | `getMentorProfile`      | Profile and Mentoring History (`/mentorship/mentor/profile`)                             |
| GET    | `/api/mentorship/mentor/has-profile`                      | `hasMentorProfile`      | `mentorRegisterGuard` on Become a Mentor (`/mentorship/mentor`)                          |
| POST   | `/api/mentorship/mentor/profile`                          | `registerMentorProfile` | Become a Mentor (`/mentorship/mentor`)                                                   |
| PATCH  | `/api/mentorship/mentor/profile`                          | `updateMentorProfile`   | Save in the profile edit drawer                                                          |
| GET    | `/api/mentorship/mentor/open-programs`                    | `getOpenPrograms`       | Program picker on Become a Mentor and the profile edit drawer                            |
| GET    | `/api/mentorship/mentor/requests`                         | `getMentorRequests`     | Request list in the profile edit drawer                                                  |
| POST   | `/api/mentorship/mentor/requests`                         | `requestToMentor`       | Become a Mentor (after the save) and the profile edit drawer                             |
| POST   | `/api/mentorship/mentor/requests/:requestId/withdraw`     | `withdrawMentorRequest` | Withdraw on a pending row in the profile edit drawer                                     |
| PUT    | `/api/mentorship/mentor/applications/:applicationId/note` | `updateApplicationNote` | Save in the note dialog on the program detail's Mentees and Applicants tabs              |
| POST   | `/api/mentorship/mentor/tasks`                            | `createMenteeTasks`     | Create in the task dialog on the program detail's Mentees tab, for one mentee or a group |

## Flow

```text
MentorProgramsComponent · MentorProgramDetailComponent · MentorProfileComponent
  → MentorshipMentorService (app)             GET /api/mentorship/mentor/*
      → mentorship.route.ts                   router.use('/mentor', mentorRouter)
      → mentorship-mentor.route.ts
      → MentorshipMentorController            401 with no signed-in user · 400 for a programId that is not a UUID
      → MentorshipMentorService (server)      404 for a program the caller does not mentor
  ← JSON
```

| Layer          | File                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Shared types   | `packages/shared/src/interfaces/mentorship-mentor.interface.ts`, exported through the interfaces barrel    |
| Router         | `apps/lfx-one/src/server/routes/mentorship-mentor.route.ts`, mounted at `/mentor` by `mentorship.route.ts` |
| Controller     | `apps/lfx-one/src/server/controllers/mentorship-mentor.controller.ts`                                      |
| Server service | `apps/lfx-one/src/server/services/mentorship-mentor.service.ts`                                            |
| App service    | `apps/lfx-one/src/app/shared/services/mentorship-mentor.service.ts`                                        |

The register page and the profile edit drawer read the program picker through `GET /open-programs`, not the admin `MentorshipService.getPrograms`.

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- `GET /programs/:programId` trims the id and answers 400 (`ServiceValidationError`) when it is not a UUID, so a slug is refused before any upstream read. It answers 404 (`ResourceNotFoundError`) when the program is not one of the caller's (see [Program detail](#program-detail)).
- The app service rethrows every failure, 404 included, so each page can tell a not-found state from a retry state.
- The read routes stay available while impersonating. The write routes (`POST /profile`, `PATCH /profile`, `POST /requests`, `POST /requests/:requestId/withdraw`, `PUT /applications/:applicationId/note` and `POST /tasks`) take `blockDuringImpersonation`, as on the mentee router (see [Impersonation](./impersonation.md)).
- Logs carry only ids, counts and flags (`programId`, `requestId`, `applicationId`, `cleared`, `program_id`, `term_id`, `term_status`, `count`, `total`, `offset`, `has_search`, `dropped`, `tasks_read_by_application`, `result_count`, `history_count`, `skills_count`, `changed_fields`, `hasProfile`, `application_count`, `created_count`, `failed_count`, a card's `mentees`, `tasksToReview` and `applicants`, and a detail's `tasks`, `mentees` and `applicants` tab counts). Names, emails, notes, task text and the introduction never go in logs.

## Registration

The Become a Mentor form (`/mentorship/mentor`) saves the mentor's profile through `POST /api/mentorship/mentor/profile` (linuxfoundation/lfx-mentorship#208). It follows the mentee registration flow (see [Mentorship Mentee Registration](./mentorship-mentee-registration.md)):

```text
mentorRegisterGuard                                     GET /api/mentorship/mentor/has-profile
  → hasProfile ? redirect to /mentorship/mentor/programs : render the form
MentorRegisterComponent.onSubmit()
  → getMentorshipMentorRegisterErrors(form)             client validation (shared)
  → buildMentorshipMentorRegisterRequest(form)          MentorshipMentorRegisterRequest
  → MentorshipMentorService.registerMentorProfile()     POST /api/mentorship/mentor/profile
      → blockDuringImpersonation                        403 IMPERSONATION_READ_ONLY
      → parseMentorshipMentorRegisterRequest(body)      types, then the form rules → 400
      → GET /mentorship/v1/me/profiles?profile_type=mentor
                                                        409 MENTOR_PROFILE_EXISTS if one exists
      → PUT /mentorship/v1/me/profiles/mentor           buildMentorshipUpstreamMentorProfile(request)
  ← 204
```

- **Why the pre-check.** Upstream `PUT …/profiles/mentor` replaces every column, so the BFF refuses with `409 MENTOR_PROFILE_EXISTS` (`ConflictError`) when the caller already has a mentor profile. If the check itself fails, the write fails closed.
- **What is sent.** `introduction`, `terms_and_conditions` (from `termsAccepted`) and `skill_set.skills`. `complianceAccepted` is validated but has no upstream column. The optional `lfxProfile` carries the name and picture the profile card shows at submit, sent as `first_name`, `last_name` and `logo_url`; the BFF adds the caller's verified primary email as `email` and the connected GitHub account's link as `profile_links.githubProfileLink`, and ignores any email in the body. It follows the same rules as the mentee form (see [LFX profile fields](./mentorship-mentee-registration.md#lfx-profile-fields)). No slug is sent; upstream reads the owner from the token.
- **Later LFX profile edits.** The card on the Profile and register pages binds `[syncMentorshipProfiles]="true"`, so an Edit LFX Profile save copies the name and picture, with the primary email and GitHub link the BFF reads, onto the mentor and mentee rows through `PATCH /api/mentorship/me/lfx-profile`; connecting an account copies the email and GitHub link. The register page syncs too, since the user may already hold a mentee profile (the BFF answers `204` without writing when they hold none), and makes the card `inert` while the save is in flight.
- **The guard.** `mentorRegisterGuard` skips the check during SSR and reads it in the browser. The app service reads a failed check as "no profile", so the form still opens and the 409 pre-check is what stops a duplicate.
- **Errors.** The page maps a failure with the shared `mapMentorshipRegisterFailure` and `MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS`, by status and code only. The kinds match the mentee form, except that a `422` shows the generic retry banner: the mentor form asks no eligibility questions. The `profile-exists` banner's button goes to My Programs.
- **After a save.** The page toasts success, sends one request per picked program (see [Program requests](#program-requests)), then navigates to `/mentorship/mentor/programs` whatever those requests answered.

## My Programs

My Programs (`/mentorship/mentor/programs`) reads one card per program the mentor belongs to through `GET /api/mentorship/mentor/programs` (linuxfoundation/lfx-mentorship#211).

```text
GET /programs → GET /mentorship/v1/me                                         local user id → isUuid, else 502 MENTORSHIP_INVALID_USER
              → GET /mentorship/v1/mentors/{userId}                           the mentor's programs and their terms · 404 → no programs
              → per program, at most 5 at once:
                  GET  /mentorship/v1/programs/{id}                           project_name
                ∥ GET  /mentorship/v1/programs/{id}/applications?term=        paged at 50 to meta.total
                ∥ GET  /mentorship/v1/programs/{id}/terms/{termId}/tasks?status=submitted
                                                                              paged at 100 to meta.total
              ← { data: MentorshipMentorProgram[], total }
```

- **The programs.** Upstream's `/mentors/{userId}` lists only the caller's active mentor memberships of published programs, each with its non-deleted terms and their dates, so the BFF does not read `/programs/{id}/terms` as well. A caller with no such membership gets 404, which is an empty list.
- **The term.** `chooseMentorshipMentorProgramTerm` (`helpers/mentorship-mentor-program.helper.ts`) picks the term each card counts and the group it goes in: the open term that started most recently (`active-term`), else the open term that starts first, an undated one last (`upcoming`), else the closed term that started most recently (`completed`). A program with no such term is `upcoming` with no term name and zero counts, and its rows are not read. Cards sort by group, then by program name (`compareMentorshipMentorProgramCards`).
- **The counts.** `sortMentorshipMentorProgramRows` sorts the chosen term's rows: mentees are `accepted` and `graduated` applications, applicants are every application, and tasks to review are submitted tasks on an `accepted` mentee's application, so a graduated mentee's leftover submission is not counted. The rows are read in full rather than counted with `limit=1` and `meta.total`, so the program detail (linuxfoundation/lfx-mentorship#212) can sort its tabs with the same helper and its counts always match the card's. The applications route resets any limit above 50 to 10, hence the smaller page (`MENTORSHIP_PROGRAM_APPLICATIONS_PAGE_SIZE`). The term dates on a card are the calendar dates upstream wrote, not shifted to UTC (`toIsoDate`).
- **Access.** The applications and tasks routes need the gateway `manager` relation on the program, which an active mentor holds. Each read uses the caller's token and `encodeURIComponent` on every id in the path. The program and term ids come from upstream, so one that is not a UUID fails the list with a 502 (`MENTORSHIP_INVALID_PROGRAM`) before any path is built from it. A failure on any program's reads, 403 and 404 included, fails the whole list rather than show counts it could not read.

## Program detail

The program detail page (`/mentorship/mentor/programs/:programId`) reads its header, tab counts and the Tasks, Mentees and Applicants rows through `GET /api/mentorship/mentor/programs/:programId` (linuxfoundation/lfx-mentorship#212).

```text
GET /programs/:programId → isUuid(programId), else 400
                         → GET /mentorship/v1/me → GET /mentorship/v1/mentors/{userId}
                                                                              the program must be one of the caller's, else 404
                         → GET  /mentorship/v1/programs/{id}                  project_name
                         ∥ GET  /mentorship/v1/programs/{id}/applications?term=
                                                                              paged at 50 to meta.total
                         ∥ GET  /mentorship/v1/programs/{id}/terms/{termId}/tasks
                                                                              every status, paged at 100 to meta.total
                           403 → per mentee, at most 5 at once:
                                 GET /mentorship/v1/applications/{applicationId}/tasks
                         ← MentorshipMentorProgramDetail { program, tabCounts, mentees, applicants }
```

- **Access.** The detail is limited to the programs `/mentors/{userId}` lists for the caller, the same list My Programs shows, so a program the caller does not mentor answers 404 before any of its rows are read. The term is the one the card counts (`chooseMentorshipMentorProgramTerm`), and the same id checks apply: a program or term id that is not a UUID fails with a 502 (`MENTORSHIP_INVALID_PROGRAM`).
- **The rows.** `mapMentorshipMentorProgramLists` (`helpers/mentorship-mentor-program.helper.ts`) builds one applicant row per application on the term and, for an `accepted` or `graduated` one, a mentee row too; upstream's `hold` reads as `pending`. Every row's `id` is the application id, and an application id that is not a UUID fails with a 502 (`MENTORSHIP_INVALID_APPLICATION`) however the tasks are read. The header counts come from the same rows through `sortMentorshipMentorProgramRows`, and the tab counts through `buildMentorshipMentorProgramDetail`, so the page and its card always agree.
- **The tasks.** The term task listing also returns tasks on mentor-role applications, which the applications route never lists, so `groupMentorshipMentorProgramTasks` keeps only tasks on a listed application (H3). `mapMentorshipMentorProgramTask` maps the upstream status through `MENTORSHIP_MENTOR_PROGRAM_TASK_STATUS_MAP` and the `prerequisite` category, file and due date onto the shared task row. The Tasks tab shows the submitted tasks of `accepted` mentees, matching the card's tasks to review, and the completed tasks of any mentee.
- **The fallback.** When the gateway refuses the term task listing with 403, the BFF logs a warning and reads each mentee's tasks from `/applications/{id}/tasks` instead, at most `MENTORSHIP_MENTEE_TASK_READ_CONCURRENCY` at once. Applicants who are not mentees then carry no tasks and show no View Tasks; the counts still match, since only `accepted` mentees' submissions are counted. Any other failure fails the page.
- **Other applications.** An applicant's other applications carry the program id, name and status (`MentorshipMentorOtherApplication`). The Applicants tab links each program name, in a new tab, to that program's public page on the mentorship site (`buildMentorshipProgramsUrl` with `environment.urls.mentorship`), never to an in-app page the mentor may not be able to open. A program id that is not a UUID is dropped, and that name shows as plain text.

## Reviewer notes

A mentor saves a reviewer note on an application from the note dialog on the program detail's Mentees and Applicants tabs, through `PUT /api/mentorship/mentor/applications/:applicationId/note` (linuxfoundation/lfx-mentorship#213).

```text
PUT /applications/:applicationId/note { note } → isUuid(applicationId), else 400
                                               → note a string of at most MENTORSHIP_MENTEE_NOTE_MAX after trimming, else 400
                                               → PUT /mentorship/v1/applications/{id}/note { reviewer_note }
                                               ← 204
```

- **Access.** Upstream decides who may write: the gateway lets a program's managers and mentors through, and the service then needs an active mentor or program administrator, else 403. An application that no longer exists answers 404. Both pass through unchanged.
- **The note.** The BFF trims the note and sends it as `reviewer_note`. An empty note clears it. The note text never goes in a log: the controller logs the application id and a `cleared` flag.
- **Reading it back.** The program's applications listing returns the note, so the rows carry it (`note`) and a saved note survives a reload.
- **App side.** `MentorProgramDetailComponent` saves the note when its dialog closes with a changed value, through `MentorNoteSaveService`, which owns the toasts: `MENTORSHIP_MENTOR_NOTE_SAVE_SUCCESS_SUMMARY`, or `MENTORSHIP_MENTOR_NOTE_CLEAR_SUCCESS_SUMMARY` for an empty note, and on failure `MENTORSHIP_MENTOR_NOTE_SAVE_ERROR_MESSAGES` for a 403 or 404, the server's message for the impersonation 403, else the fallback. A saved note is written into the page's rows (`linkedSignal` over the loaded detail, so a reload replaces it), on both tabs, since an accepted or graduated mentee is listed on each under one application id. A row's dialog does not reopen while its save is in flight. The save is not tied to the page, so it and its toast finish if the mentor leaves first. A failed save keeps the row as it was and does not keep the typed note.

## Tasks

A mentor creates a task for one accepted mentee, or the same task for several, from the task dialog on the program detail's Mentees tab, through `POST /api/mentorship/mentor/tasks` (linuxfoundation/lfx-mentorship#214). Upstream has no batch create, so the BFF writes one task per application.

```text
POST /tasks { applicationIds, name, description, dueDate?, requiresFileSubmission? }
  → 1 to MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS application UUIDs (lowercased, a repeat dropped; refused at the first id past the cap), else 400
  → name and description required after trimming, within MENTORSHIP_TASK_NAME_MAX / MENTORSHIP_TASK_DESCRIPTION_MAX, else 400
  → dueDate a calendar YYYY-MM-DD when set, requiresFileSubmission a boolean when set, else 400
  → GET /mentorship/v1/me                           (the caller's local user id, read once)
  → per application, at most MENTORSHIP_MENTOR_TASK_CREATE_CONCURRENCY at once:
      GET  /mentorship/v1/applications/{id}         (must be an accepted mentee's, else 400)
      POST /mentorship/v1/applications/{id}/tasks   { assignee_id, program_term_id, owner_id, created_by, name, description,
                                                      category: non_prerequisite, custom: true, due_date?, submit_file? }
  ← 200 { created, failed }
```

- **What the browser sends.** Only the application ids and the task's text, due date and file flag. The assignee and term come from the application upstream returns, and the owner and author are the caller's local user id, so none of them is taken from the browser. A mentor's task is always a custom, non-prerequisite task; a required file is sent as `submit_file: 'required'`.
- **Who can be given a task.** Upstream takes a task only on an accepted mentee's application, so the BFF refuses a graduated, withdrawn or mentor application (`isMentorshipTaskAssignableApplication`) before writing. The Mentees tab offers create only on accepted mentees, and Create Group Task preselects only them.
- **Access.** Upstream decides who may write: an active mentor or program administrator of the application's program, else 403. Both upstream calls use the caller's token.
- **One application or many.** With one application, a failure passes through with its status. With several, each runs on its own (`Promise.allSettled`), and the 200 lists the ids in `created` and `failed` in request order; each failure logs a warning with the application id, status and code, never the task text.
- **App side.** `MentorProgramDetailComponent` takes the tab's `taskCreateRequested` and creates through `MentorTaskCreateService`, which owns the toasts: `MENTORSHIP_MENTOR_TASK_CREATE_SUCCESS_SUMMARY` (naming the count for a group), `MENTORSHIP_MENTOR_TASK_CREATE_PARTIAL_SUMMARY` as a warning when some failed (naming the missed mentees), an error when none was created, and for a failed request `MENTORSHIP_MENTOR_TASK_CREATE_ERROR_MESSAGES` for a 400, 403 or 404, the server's message for the impersonation 403, else the fallback. Upstream's create is not idempotent, and a failure without a status of its own (a timeout, a 5xx) may still have created the task, so every failure copy sends the mentor to the row rather than to a retry. A group past `MENTORSHIP_MENTOR_TASK_CREATE_MAX_APPLICATIONS` (shared, also the BFF's cap) is sent in batches of that size, one after another, with a failed batch counting its mentees as failed. After every create attempt, whatever its outcome, the page re-reads the detail without its loading state, so the rows show what upstream holds on the Mentees and Tasks tabs; the re-read is dropped if the mentor has left or moved to another program or a later re-read has started, and a failed re-read keeps the rows on screen. The create is not tied to the page, so it and its toast finish if the mentor leaves first.

## Profile and Mentoring History

The Profile page (`/mentorship/mentor/profile`) reads the mentor's profile and Mentoring History through `GET /api/mentorship/mentor/profile`, and the edit drawer saves the introduction and skills through `PATCH /api/mentorship/mentor/profile` (linuxfoundation/lfx-mentorship#210).

```text
GET   /profile   → GET /mentorship/v1/me/profiles/mentor                           mapMentorshipMentorProfileDetails · 404 → empty
                 ∥ GET /mentorship/v1/me                                           local user id → isUuid, else 502 MENTORSHIP_INVALID_USER
                   → GET /mentorship/v1/mentors/{userId}                           mapMentorshipMentoringHistory · 404 → []
                 ← { profile, history }
PATCH /profile   → blockDuringImpersonation                                        403 IMPERSONATION_READ_ONLY
   { introduction?, skills? }
                 → parseMentorshipMentorProfileUpdate(body)                        allowlist, types, then the form rules → 400
                 → GET /mentorship/v1/me/profiles/mentor                           only when the skills change
                 → PATCH /mentorship/v1/me/profiles/mentor                         buildMentorshipUpstreamMentorProfileUpdate
                 ← { profile }
```

- **No profile row.** Both reads use upstream's typed `GET …/profiles/mentor`, which answers 404 when the caller has no mentor profile and 409 when there is more than one, rather than pick one. A caller with no mentor profile gets the empty profile, with the history still read, as the mentee page does. The registration pre-check and `/has-profile` only ask whether a row exists, so they keep the `limit=1` list.
- **The history.** `mapMentorshipMentoringHistory` builds one row per distinct (program name, term name) pair across the mentor's current and graduated mentees, plus the term `chooseMentorshipMentorTerm` picks for each program the mentor belongs to, so a term with no mentees yet is listed with a count of zero. That choice is the latest open term that has started, else the latest closed term; an open term that has not started (or has no start) is never chosen, so a cohort that has not begun is not listed as in progress. A program with no such term is not listed. A row reads in progress when one of its matching terms is open and has started (`isMentorshipMentorTermUnderway`), and completed otherwise. A row whose matching terms are all open but not started is not listed either, even though upstream already lists that cohort's accepted mentees as current. Upstream answers `/mentors/{userId}` with 404 when the caller has no active membership of a published program; that is an empty history, not a failure.
- **Matching by name (H11).** A mentee row names its program and term but carries neither id, so the history matches it to the program's terms by program name and term name. Two terms of one program with the same name merge into one row, with a generated id. Upstream also lists each mentee at most once as current and once as graduated (its latest term of each), so a mentee who joined more than one term is counted in one of them only.
- **What PATCH sends.** Only the fields the mentor changed: the drawer builds the request with `buildMentorshipMentorProfileUpdate`, which compares against the profile it was opened with, and Save with no change closes without a request. Upstream keeps every column the body leaves out but replaces `skill_set` whole, so when the skills change the BFF reads the stored row first and layers the new skills over its `skill_set`, keeping keys the UI does not show. A failed read fails the save. The read and the write are not atomic, so an edit made elsewhere in between can be overwritten. `profile_links` is never sent; the LFX profile sync owns it.
- **Validation.** `parseMentorshipMentorProfileUpdate` refuses an unknown key, a null value or an empty body, drops repeated skills, then runs the rules the drawer and the register form share (`getMentorshipMentorProfileErrors`) on the present fields. The introduction HTML is stored as sent, capped but not sanitised: every render path sanitises it.
- **App side.** `MentorProfileSaveService` sends the save, toasts `MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY` and maps a failure to `MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES` (400, 404, 409) or the fallback; a BFF validation 400 and the impersonation 403 show the server's message. The drawer shows that message inline and stays open with the mentor's input, makes the profile fields `inert` and blocks closing while the save is in flight. On success it emits `saved`, and the page shows the saved profile in place without re-reading it or the history; a Retry drops that override.
- **Upstream errors.** The GET passes upstream's 409 (more than one mentor profile) through. A PATCH passes its 404 (no mentor profile) and 409 through, from the stored-row read or the write.

## Program requests

A mentor asks to join a program, and withdraws a request still waiting on the program administrator, through four routes (linuxfoundation/lfx-mentorship#209). Upstream stores a request as the caller's `program_members` row with `member_type: 'mentor'`, not as an application: a mentor joins the whole program, not a term. The routes sit on upstream's self-service `/v1/me/program-memberships` (linuxfoundation/lfx-mentorship#218), which takes the user from the token and never from the body.

```text
GET  /open-programs?search=&offset=          → parseMentorshipMentorOpenProgramsQuery → 400
                                            → GET /mentorship/v1/programs?status=published&limit=20&offset=&search=   (one page)
                                              ← { data: [{ id, name }], total }
GET  /requests                              → GET /mentorship/v1/me/program-memberships?member_type=mentor  (paged to the end)
                                              ← { data: [{ id, programId, programName, status }], invitedProgramIds }
POST /requests { programId }                → blockDuringImpersonation · isUuid(programId) → 400
                                            → POST /mentorship/v1/me/program-memberships { program_id }
                                              ← 204
POST /requests/:requestId/withdraw          → blockDuringImpersonation · isUuid(requestId) → 400
                                            → POST /mentorship/v1/me/program-memberships/{id}/withdraw
                                              ← 204
```

- **The picker's read.** `GET /open-programs` returns one page of published programs from the plain program list, mapped to `{ id, name }` by `mapMentorshipMentorOpenProgram`, with upstream's `meta.total` as `total` (when upstream sends none, `offset` plus the page length, which ends paging). The public catalog is not used: the picker needs only the id and name. The page size is fixed server-side (`MENTORSHIP_MENTOR_OPEN_PROGRAMS_PAGE_SIZE`, 20). `offset` must be a non-negative integer and `search` at most `MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_MAX_LENGTH` characters, or the route answers 400; a blank value is left out. Upstream matches `search` with `name ILIKE '%…%'`, so `escapeMentorshipIlikeSearch` escapes `%`, `_` and the backslash to keep the search literal.
- **The picker.** `MentorProgramsSectionComponent` reads the programs itself, a page at a time: typing in the select's filter searches upstream once typing pauses (`MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS`), cut to the length the BFF accepts without splitting a surrogate pair (`truncateToUtf16Units`) and sent through `strictHttpParams` so a `+` stays a `+`, and scrolling the virtual list to its last loaded row reads the next page. A new search cancels a page still in flight, and keeps the previous programs listed until its first page answers; meanwhile an empty list says `MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE` rather than "no results", since an unfiltered read can take seconds. Closing the select (a pick closes it too) clears both its filter box (`resetFilterOnHide`) and the search behind it (an `onBeforeHide` overlay callback), so it always reopens on every program; the programs already read with no search are kept and listed again at once, not re-read. A failed page shows `MENTORSHIP_MENTOR_PROGRAMS_LOAD_FAILED_MESSAGE` with its own Retry, never an empty list. The section sizes the list itself, one row per program up to `MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT`, and turns off the PrimeNG scroller's auto-size (`MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS`): auto-size measures the list before redrawing it for a new item count, so a search that matched after one that matched nothing kept the empty list's few-px height. Programs with a pending, accepted or declined request (`MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES`), which upstream refuses a new request for, stay listed but disabled with the status as a note, and so do programs in `invitedProgramIds`, noted `Invited`, and programs a request found gone (`unavailableProgramIds`), noted `MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE` over any other note. A withdrawn one can be picked again: asking again reopens the same row as `requested`. The register page does not read the requests, so a program picked there that upstream refuses shows one failure toast.
- **Upstream errors.** A request passes upstream's `404` through when the program is gone or hidden, and its `409` when the caller already has an `invited`, `requested`, `pending`, `active` or `declined` row for it. A withdraw passes its `404` through when the row is not the caller's, and its `409` when the row is no longer `requested` or `pending`. Upstream sends no invite email for a self-request.
- **Statuses.** `mapMentorshipMentorProgramRequests` folds the upstream member status through `MENTORSHIP_MENTOR_REQUEST_STATUS_MAP`: `requested` and `pending` read as pending, `active` as accepted, and `declined` and `withdrawn` as themselves. It drops `invited` rows, which are not requests the mentor made (mentor invites are a later story); `mapMentorshipMentorInvitedProgramIds` returns their programs as `invitedProgramIds` instead. The read logs only the row counts (`count`, `invited`, `dropped`). Only a pending row offers Withdraw.
- **App side.** `MentorshipMentorService` caches `getMentorRequests()` and bumps `mentorRequestsRevision` after every request or withdraw, so the drawer re-reads the list. A failed read is not shown as an empty list: the drawer passes `requestsFailed` to the section, which shows `MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE` with a Retry button and disables the picker until a read succeeds, and passes `requestsLoading` so the picker also waits while an open reads the list; Retry calls `clearMentorCaches()`. Two module services own the toasts, so no caller handles an error: `MentorProgramRequestService` (`request`, and `requestMany`, which sends one at a time and names each failed program) and `MentorRequestWithdrawService` (confirms first). A request's `404` or `409` shows `MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES`, and a withdraw's shows `MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES`; both re-read the list. A request's `404` also calls `markProgramUnavailable`, since re-reading the requests cannot drop the program from a page of programs already read; the impersonation `403` shows the server's message.
- **Where they run.** The register page keeps picks local until the profile saves, then calls `requestMany`, and navigates once they settle only if the page is still open. The profile edit drawer sends a pick and a confirmed withdraw right away. It mounts the programs section on its first open, not with the profile page (projected content is created even while the drawer is hidden), and keeps it mounted after a close. Its Save is separate (see [Profile and Mentoring History](#profile-and-mentoring-history)): requests never wait for it.

## Data source

Every mentor route calls the mentorship service: My Programs, the program detail, the profile read and update, the has-profile check, the register save, the program requests, the reviewer notes and the task create. Story linuxfoundation/lfx-mentorship#206 replaced the mock seed data one screen at a time.

A wired route calls the mentorship service through `proxyMentorshipRequest` in `helpers/mentorship-api.helper.ts`, with the user's own bearer token, as the mentee BFF does. `listAllMentorshipPages` in the same helper reads an upstream list to the end, at the largest page size unless the caller passes a smaller one. The mentor service uses it for the published programs, the caller's mentor memberships, and each program's applications (at 50) and submitted tasks; the mentee service uses it for the caller's applications and an application's tasks.

## Related documentation

- [Mentorship Mentee Registration](./mentorship-mentee-registration.md)
- [Impersonation](./impersonation.md)
- [Server Helpers](./server-helpers.md)
