<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Mentor BFF

The mentor pages under `/mentorship/mentor/*` read their data from the LFX One BFF's `/api/mentorship/mentor/*` routes. The mentor code has its own router, controller and services, separate from the admin and mentee code, so each mentor screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#206).

## Routes

| Method | Path                                         | Controller method   | Page                                                         |
| ------ | -------------------------------------------- | ------------------- | ------------------------------------------------------------ |
| GET    | `/api/mentorship/mentor/programs`            | `getMentorPrograms` | My Programs (`/mentorship/mentor/programs`)                  |
| GET    | `/api/mentorship/mentor/programs/:programId` | `getMentorProgram`  | Program detail (`/mentorship/mentor/programs/:programId`)    |
| GET    | `/api/mentorship/mentor/profile`             | `getMentorProfile`  | Profile and Mentoring History (`/mentorship/mentor/profile`) |

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
- The routes are reads, so they stay available while impersonating. Only write routes take `blockDuringImpersonation`, as on the mentee router (see [Impersonation](./impersonation.md)).
- Logs carry only ids and counts (`programId`, `result_count`, `history_count`). Names, emails and notes never go in logs.

## Data source

Every route still returns the shared mock seed data from `packages/shared/src/constants/mentorship-mentor.constants.ts`, and none calls the mentorship service yet. Story linuxfoundation/lfx-mentorship#206 replaces the mocks one screen at a time.

A wired route calls the mentorship service through `proxyMentorshipRequest` in `helpers/mentorship-api.helper.ts`, with the user's own bearer token, as the mentee BFF does. `listAllMentorshipPages` in the same helper reads an upstream list to the end. The mentee service uses it for the caller's applications and an application's tasks.

## Related documentation

- [Mentorship Mentee Registration](./mentorship-mentee-registration.md)
- [Impersonation](./impersonation.md)
- [Server Helpers](./server-helpers.md)
