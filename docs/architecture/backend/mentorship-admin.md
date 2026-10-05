<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Admin BFF

The admin pages under `/mentorship/admin/*` read their data from the LFX One BFF's `/api/mentorship/admin/*` routes. The admin code has its own router, controller and services, separate from the mentor and mentee code, so each admin screen can move to the mentorship service without touching the other two (linuxfoundation/lfx-mentorship#229).

The program list reads the mentorship service in one call (see [Program list sourcing](#program-list-sourcing)). The program detail still reads mock data (`MOCK_MENTORSHIP_PROGRAMS`, `MOCK_MENTORSHIP_PROGRAM_LISTS`). Later PRs in the story replace the mocks one screen at a time.

## Routes

| Method | Path                                        | Controller method | Page                                                   |
| ------ | ------------------------------------------- | ----------------- | ------------------------------------------------------ |
| GET    | `/api/mentorship/admin/programs`            | `getPrograms`     | Admin program list, and the import picker on Enroll    |
| GET    | `/api/mentorship/admin/programs/:programId` | `getProgram`      | Admin program detail (tabs, counts and the four lists) |

`programId` is the program's id or its slug. The list accepts `search`, `status`, `offset` and `limit` (1–50, default 12; a malformed or out-of-range value is a 400).

The program detail has four tabs: Current Mentees, Past Mentees, Mentors and Terms. `buildMentorshipProgramDetail` (shared utils) splits the program's applications by their term's status. Rows in an open term go to `currentMentees` and rows in a closed term go to `pastMentees`; the row's own status plays no part. A row whose term the program doesn't list stays current. `tabCounts` is built from the same lists, so a count always matches its tab.

## Program list sourcing

`getPrograms` makes one call to upstream `GET /mentorship/v1/me/programs` (lfx-mentorship#243) with the caller's bearer token, so upstream decides what the caller may see:

- `search` is trimmed, cut to 100 characters, and its `\`, `%` and `_` are escaped. `status` is the chosen status with `-` written as `_`. `limit` is at most 50 here and `offset` is passed through. No `limit` above the upstream maximum is ever sent.
- Upstream searches the program and project names, filters by status, sorts by name then id, pages, and returns each row with its latest open term (else the latest closed one), its counts and `admin_status`. The BFF maps each row and returns upstream's `meta.total`.
- A not-provisioned error gives an empty page. Any other error propagates, and the page shows its failed-load state with Retry.
- Upstream lists only direct `program_admin` memberships. Admins who only inherit access from the project are not listed yet, but can still open a program by URL.

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

`apps/lfx-one/src/server/helpers/mentorship-program-application.helper.ts` maps an upstream task and an upstream application row to the detail-row shapes. The mentor program detail uses it today. The admin program detail still reads the mock lists directly and will use it once it moves to the mentorship service. The caller passes the application status map, because the two surfaces show some upstream statuses differently (the mentor map shows `hold` as `pending`).

## Behavior

- Every route needs a signed-in user. The controller throws `AuthenticationError` (401) when `getUsernameFromAuth` finds none.
- The program list forwards the caller's bearer token and only lists programs the caller administers. The detail route checks only that a user is signed in and serves mock data today. When a screen moves to the mentorship service, it must forward the caller's bearer token so upstream enforces admin access, or add a BFF-side admin guard, with a 403 test for a non-admin user.
- The read routes stay available while impersonating. Admin write routes added later take `blockDuringImpersonation` (see [Impersonation](./impersonation.md)).
- The app service lets a program-list failure reach the page, which shows an inline error with Retry. A detail failure falls back to `null`, and a 404 is not logged.
- Logs carry ids, counts, flags and the list filters (never the `search` text). Names and emails never go in logs.
