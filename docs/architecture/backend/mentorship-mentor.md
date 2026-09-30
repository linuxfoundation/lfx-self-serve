<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Mentor BFF

The mentor pages under `/mentorship/mentor/*` read their data from the LFX One BFF's `/api/mentorship/mentor/*` routes. The mentor code has its own router, controller and services, separate from the admin and mentee code, so each mentor screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#206).

## Routes

| Method | Path                                         | Controller method       | Page                                                            |
| ------ | -------------------------------------------- | ----------------------- | --------------------------------------------------------------- |
| GET    | `/api/mentorship/mentor/programs`            | `getMentorPrograms`     | My Programs (`/mentorship/mentor/programs`)                     |
| GET    | `/api/mentorship/mentor/programs/:programId` | `getMentorProgram`      | Program detail (`/mentorship/mentor/programs/:programId`)       |
| GET    | `/api/mentorship/mentor/profile`             | `getMentorProfile`      | Profile and Mentoring History (`/mentorship/mentor/profile`)    |
| GET    | `/api/mentorship/mentor/has-profile`         | `hasMentorProfile`      | `mentorRegisterGuard` on Become a Mentor (`/mentorship/mentor`) |
| POST   | `/api/mentorship/mentor/profile`             | `registerMentorProfile` | Become a Mentor (`/mentorship/mentor`)                          |

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

The register page and the profile edit drawer still read open programs through `MentorshipService.getPrograms`.

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- `GET /programs/:programId` trims the id and answers 400 (`ServiceValidationError`) when it is blank. It accepts a program id or slug, and answers 404 (`ResourceNotFoundError`) when neither matches.
- The app service rethrows every failure, 404 included, so each page can tell a not-found state from a retry state.
- The read routes stay available while impersonating. The write route, `POST /profile`, takes `blockDuringImpersonation`, as on the mentee router (see [Impersonation](./impersonation.md)).
- Logs carry only ids, counts and flags (`programId`, `result_count`, `history_count`, `skills_count`, `hasProfile`). Names, emails, notes and the introduction never go in logs.

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
- **After a save.** The page toasts success and navigates to `/mentorship/mentor/programs`. Program requests and the resume file name stay local: there is no endpoint for either yet, so picked programs get a coming-soon toast after the profile saves.

## Data source

The has-profile check and the register save call the mentorship service. Every other route still returns the shared mock seed data from `packages/shared/src/constants/mentorship-mentor.constants.ts`. Story linuxfoundation/lfx-mentorship#206 replaces the mocks one screen at a time.

A wired route calls the mentorship service through `proxyMentorshipRequest` in `helpers/mentorship-api.helper.ts`, with the user's own bearer token, as the mentee BFF does. `listAllMentorshipPages` in the same helper reads an upstream list to the end. The mentee service uses it for the caller's applications and an application's tasks.

## Related documentation

- [Mentorship Mentee Registration](./mentorship-mentee-registration.md)
- [Impersonation](./impersonation.md)
- [Server Helpers](./server-helpers.md)
