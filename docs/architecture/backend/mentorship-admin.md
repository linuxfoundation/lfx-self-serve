<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The admin screens still read mock data (`MOCK_MENTORSHIP_PROGRAMS`, `MOCK_MENTORSHIP_PROGRAM_LISTS`). Later PRs in the story replace the mocks one screen at a time.

## Routes

| Method | Path                                        | Controller method | Page                                                   |
| ------ | ------------------------------------------- | ----------------- | ------------------------------------------------------ |
| GET    | `/api/mentorship/admin/programs`            | `getPrograms`     | Admin program list, and the import picker on Enroll    |
| GET    | `/api/mentorship/admin/programs/:programId` | `getProgram`      | Admin program detail (tabs, counts and the four lists) |

`programId` is the program's id or its slug. The list accepts `search`, `status`, `offset` and `limit` (clamped to 1–50, default 50).

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

`apps/lfx-one/src/server/helpers/mentorship-program-application.helper.ts` maps an upstream task and an upstream application row to the detail-row shapes. The mentor and admin program detail both use it. The caller passes the application status map, because the two surfaces show some upstream statuses differently (the mentor map shows `hold` as `pending`).

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- The read routes stay available while impersonating. Admin write routes added later take `blockDuringImpersonation` (see [Impersonation](./impersonation.md)).
- The app service falls back to an empty list (or `null` for a detail) on any failure, so the admin pages never block on a fault. A 404 is not logged.
- Logs carry only ids, counts and flags. Names and emails never go in logs.
