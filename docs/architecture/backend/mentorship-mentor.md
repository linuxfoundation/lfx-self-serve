<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Mentor BFF

The mentor pages under `/mentorship/mentor/*` read their data from the LFX One BFF's `/api/mentorship/mentor/*` routes. The mentor code has its own router, controller and services, separate from the admin and mentee code, so each mentor screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#206).

## Routes

| Method | Path                                                  | Controller method       | Page                                                            |
| ------ | ----------------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| GET    | `/api/mentorship/mentor/programs`                     | `getMentorPrograms`     | My Programs (`/mentorship/mentor/programs`)                     |
| GET    | `/api/mentorship/mentor/programs/:programId`          | `getMentorProgram`      | Program detail (`/mentorship/mentor/programs/:programId`)       |
| GET    | `/api/mentorship/mentor/profile`                      | `getMentorProfile`      | Profile and Mentoring History (`/mentorship/mentor/profile`)    |
| GET    | `/api/mentorship/mentor/has-profile`                  | `hasMentorProfile`      | `mentorRegisterGuard` on Become a Mentor (`/mentorship/mentor`) |
| POST   | `/api/mentorship/mentor/profile`                      | `registerMentorProfile` | Become a Mentor (`/mentorship/mentor`)                          |
| GET    | `/api/mentorship/mentor/open-programs`                | `getOpenPrograms`       | Program picker on Become a Mentor and the profile edit drawer   |
| GET    | `/api/mentorship/mentor/requests`                     | `getMentorRequests`     | Request list in the profile edit drawer                         |
| POST   | `/api/mentorship/mentor/requests`                     | `requestToMentor`       | Become a Mentor (after the save) and the profile edit drawer    |
| POST   | `/api/mentorship/mentor/requests/:requestId/withdraw` | `withdrawMentorRequest` | Withdraw on a pending row in the profile edit drawer            |

## Flow

```text
MentorProgramsComponent · MentorProgramDetailComponent · MentorProfileComponent
  → MentorshipMentorService (app)             GET /api/mentorship/mentor/*
      → mentorship.route.ts                   router.use('/mentor', mentorRouter)
      → mentorship-mentor.route.ts
      → MentorshipMentorController            401 with no signed-in user · 400 for a blank programId
      → MentorshipMentorService (server)      404 for an unknown program
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
- `GET /programs/:programId` trims the id and answers 400 (`ServiceValidationError`) when it is blank. It accepts a program id or slug, and answers 404 (`ResourceNotFoundError`) when neither matches.
- The app service rethrows every failure, 404 included, so each page can tell a not-found state from a retry state.
- The read routes stay available while impersonating. The write routes (`POST /profile`, `POST /requests` and `POST /requests/:requestId/withdraw`) take `blockDuringImpersonation`, as on the mentee router (see [Impersonation](./impersonation.md)).
- Logs carry only ids, counts and flags (`programId`, `requestId`, `count`, `total`, `offset`, `has_search`, `dropped`, `result_count`, `history_count`, `skills_count`, `hasProfile`). Names, emails, notes and the introduction never go in logs.

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
- **What is sent.** `introduction`, `terms_and_conditions` (from `termsAccepted`) and `skill_set.skills`. `complianceAccepted` is validated but has no upstream column. The optional `lfxProfile` carries the name and picture the profile card shows at submit, sent as `first_name`, `last_name` and `logo_url`; the BFF adds the caller's verified primary email as `email` and ignores any email in the body. It follows the same rules as the mentee form (see [LFX profile fields](./mentorship-mentee-registration.md#lfx-profile-fields)). No slug or resume is sent; upstream reads the owner from the token.
- **Later LFX profile edits.** The Profile page's card binds `[syncMentorshipProfiles]="true"`, so an Edit LFX Profile save copies the name and picture, with the primary email the BFF reads, onto the mentor and mentee rows through `PATCH /api/mentorship/me/lfx-profile`. The register page does not sync, and makes the card `inert` while the save is in flight.
- **The guard.** `mentorRegisterGuard` skips the check during SSR and reads it in the browser. The app service reads a failed check as "no profile", so the form still opens and the 409 pre-check is what stops a duplicate.
- **Errors.** The page maps a failure with the shared `mapMentorshipRegisterFailure` and `MENTORSHIP_MENTOR_REGISTER_FAILURE_OPTIONS`, by status and code only. The kinds match the mentee form, except that a `422` shows the generic retry banner: the mentor form asks no eligibility questions. The `profile-exists` banner's button goes to My Programs.
- **After a save.** The page toasts success, sends one request per picked program (see [Program requests](#program-requests)), then navigates to `/mentorship/mentor/programs` whatever those requests answered. The resume file name stays local: there is no endpoint for it yet.

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
- **The picker.** `MentorProgramsSectionComponent` reads the programs itself, a page at a time: typing in the select's filter searches upstream once typing pauses (`MENTORSHIP_MENTOR_OPEN_PROGRAMS_SEARCH_DEBOUNCE_MS`), cut to the length the BFF accepts, and scrolling the virtual list to its last loaded row reads the next page. A new search cancels a page still in flight, and keeps the previous programs listed until its first page answers; meanwhile an empty list says `MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE` rather than "no results", since an unfiltered read can take seconds. Closing the select (a pick closes it too) clears both its filter box (`resetFilterOnHide`) and the search behind it (an `onBeforeHide` overlay callback), so it always reopens on every program; the programs already read with no search are kept and listed again at once, not re-read. A failed page shows `MENTORSHIP_MENTOR_PROGRAMS_LOAD_FAILED_MESSAGE` with its own Retry, never an empty list. The section sizes the list itself, one row per program up to `MENTORSHIP_MENTOR_PICKER_MAX_HEIGHT`, and turns off the PrimeNG scroller's auto-size (`MENTORSHIP_MENTOR_PICKER_SCROLLER_OPTIONS`): auto-size measures the list before redrawing it for a new item count, so a search that matched after one that matched nothing kept the empty list's few-px height. Programs with a pending, accepted or declined request (`MENTORSHIP_MENTOR_PICKER_EXCLUDED_STATUSES`), which upstream refuses a new request for, stay listed but disabled with the status as a note, and so do programs in `invitedProgramIds`, noted `Invited`. A withdrawn one can be picked again: asking again reopens the same row as `requested`. The register page does not read the requests, so a program picked there that upstream refuses shows one failure toast.
- **Upstream errors.** A request passes upstream's `404` through when the program is gone or hidden, and its `409` when the caller already has an `invited`, `requested`, `pending`, `active` or `declined` row for it. A withdraw passes its `404` through when the row is not the caller's, and its `409` when the row is no longer `requested` or `pending`. Upstream sends no invite email for a self-request.
- **Statuses.** `mapMentorshipMentorProgramRequests` folds the upstream member status through `MENTORSHIP_MENTOR_REQUEST_STATUS_MAP`: `requested` and `pending` read as pending, `active` as accepted, and `declined` and `withdrawn` as themselves. It drops `invited` rows, which are not requests the mentor made (mentor invites are a later story); `mapMentorshipMentorInvitedProgramIds` returns their programs as `invitedProgramIds` instead. The read logs only the row counts (`count`, `invited`, `dropped`). Only a pending row offers Withdraw.
- **App side.** `MentorshipMentorService` caches `getMentorRequests()` and bumps `mentorRequestsRevision` after every request or withdraw, so the drawer re-reads the list. A failed read is not shown as an empty list: the drawer passes `requestsFailed` to the section, which shows `MENTORSHIP_MENTOR_REQUESTS_LOAD_FAILED_MESSAGE` with a Retry button and disables the picker until a read succeeds, and passes `requestsLoading` so the picker also waits while an open reads the list; Retry calls `clearMentorCaches()`. Two module services own the toasts, so no caller handles an error: `MentorProgramRequestService` (`request`, and `requestMany`, which sends one at a time and names each failed program) and `MentorRequestWithdrawService` (confirms first). A request's `404` or `409` shows `MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES`, and a withdraw's shows `MENTORSHIP_MENTOR_WITHDRAW_STALE_ERROR_MESSAGES`; both re-read the list, and the impersonation `403` shows the server's message.
- **Where they run.** The register page keeps picks local until the profile saves, then calls `requestMany`, and navigates once they settle only if the page is still open. The profile edit drawer sends a pick and a confirmed withdraw right away. The drawer's Save still shows the coming-soon toast: the profile update endpoint is not wired yet.

## Data source

The has-profile check, the register save and the program request routes call the mentorship service. Every other route still returns the shared mock seed data from `packages/shared/src/constants/mentorship-mentor.constants.ts`. Story linuxfoundation/lfx-mentorship#206 replaces the mocks one screen at a time.

A wired route calls the mentorship service through `proxyMentorshipRequest` in `helpers/mentorship-api.helper.ts`, with the user's own bearer token, as the mentee BFF does. `listAllMentorshipPages` in the same helper reads an upstream list to the end. The mentor service uses it for the published programs and the caller's mentor memberships; the mentee service uses it for the caller's applications and an application's tasks.

## Related documentation

- [Mentorship Mentee Registration](./mentorship-mentee-registration.md)
- [Impersonation](./impersonation.md)
- [Server Helpers](./server-helpers.md)
