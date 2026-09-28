<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Project Applications BFF

"Propose a project" (#3037) lets any signed-in user submit a project application. The LF formation team then reviews it. The backend is `lfx-v2-formation-service`'s `/project-applications` routes (#1962). Reads go through query-service.

## Routes

Everything is mounted at `/api/project-applications` (`routes/project-applications.route.ts`). The global `authMiddleware` requires a session for every route. Writes also use `blockDuringImpersonation`.

| Route                           | Upstream                                                                                                     | Token   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| `GET /mine`                     | `GET /query/resources?type=project_application&tags=submitter:<username>`                                    | user    |
| `GET /queue`                    | `GET /query/resources?type=project_application` (no project-tree filter)                                     | user    |
| `GET /access`                   | access-check `team:formation#member`                                                                         | user    |
| `POST /`                        | `POST /project-applications`                                                                                 | **M2M** |
| `PUT /:uid`                     | `PUT /project-applications/{uid}` (`If-Match`)                                                               | user    |
| `POST /:uid/withdraw` · `/deny` | `POST /project-applications/{uid}/withdraw` · `/deny` (`If-Match`)                                           | user    |
| `POST /:uid/accept`             | `PUT /project-applications/{uid}`, project-service `POST /projects`, `PUT` again, then `POST …/{uid}/accept` | user    |
| `DELETE /:uid`                  | `DELETE /project-applications/{uid}` (`If-Match`, 204)                                                       | user    |

## Why create uses M2M

This is a deliberate, approved exception, not an instance of the existing "explicit privileged upstream call" case in `.claude/rules/development-rules.md`. That case requires an in-app authorization check first; here there is none beyond "has a session", because any signed-in user may propose.

The formation-service contract has the UI authenticate **as itself** on create. The gateway admits only `team:global_project_application_admin`, and the self-serve M2M principal is the member of that team. That way any signed-in user can propose a project without needing a per-user grant.

What keeps the exception narrow:

- The route requires a session and refuses impersonation.
- The M2M token is scoped to this one call with `{ bearerToken }`.
- The submitter's `username`, `name` and `email` are copied from the session into the payload, so the application is attributable to the person who submitted it. The browser only ever sends `application`, and the staff-only keys (`parent_project_uid`, `project_slug`, `project_uid`) are stripped from it.
- Every other route uses the caller's own token.

## Concurrency

Every mutation after create forwards the application's `revision` as a bare-digit `If-Match`, checked by `parseIfMatch`. Upstream returns the next revision in `ETag`, and the BFF passes it through.

A `412` becomes `PreconditionFailedError`. The UI never replays a write after a 412; it reloads and lets the user try again.

query-service lags behind successful writes. The UI therefore records each write result in an overlay in the root-scoped browser `ProjectApplicationService`, kept per list mode (`submitter` / `staff`), and applies it to every read instead of refetching straight away. Because the overlay is root-scoped, it survives a tab switch that destroys the list. `reconcile` prunes an entry once a read returns the same or a newer revision, or stops returning a deleted UID.

A 404 on any write means the application is gone: the UI drops it from the list (`recordDeleted`) rather than reloading.

## Accept: parent project and project creation

The upstream accept route takes no body and creates nothing. Accepting creates the project in project-service (#1995). In the accept dialog, the formation team picks the parent project and a slug. The slug is prefilled from the proposed name by `projectSlugFromName` and must match project-service's `PROJECT_SLUG_REGEX`. Accept then runs as an access pre-check followed by these writes, all with the caller's own token:

1. The BFF checks that the caller is in `team:formation`. This is a guard, not the authorization: revise only needs `writer`, so a submitter could otherwise commit a write and then be refused the accept.
2. It revises the complete answer map, adding `application.parent_project_uid` and `application.project_slug`.
3. It creates the project with `POST /projects` (`X-Sync: true`). The body comes from `buildCreateProjectRequest`:
   - `project_name` → `name`
   - `description`, `mission_statement` → the same fields
   - `project_repository_url` → `repository_url`
   - `project_website` → `website_url`
   - `stage` = `Formation - Exploratory`
   - `legal_entity_type` = `Subproject`
   - `category` = `Standards` when `is_spec_project` is true

   Blank optional answers are left out. It then revises again, adding `application.project_uid`. If the answers already carry a `project_uid`, both steps are skipped, and the recorded parent and slug are kept even if the dialog sent new ones. That happens on a retry after the create landed but a later step failed, so the project is never created twice. The uid can also be lost before it is recorded, when the follow-up revise fails or a submitter's revise drops the staff keys. In that case the retried create gets a 409 on the slug. The BFF then looks the slug up with `getProjectIdBySlug` and reads the project. It adopts the project only if it sits under the same parent with the same name.

4. It accepts at the latest revision.

The create comes before the accept. A refused create therefore leaves the application submitted, not accepted with no project. project-service refusals map as follows:

| project-service status | BFF error             | Code                       |
| ---------------------- | --------------------- | -------------------------- |
| 409 (not adoptable)    | `ConflictError`       | `PROJECT_SLUG_CONFLICT`    |
| 403                    | `AuthorizationError`  | `PROJECT_CREATE_FORBIDDEN` |
| 400                    | `InvalidRequestError` | `INVALID_PROJECT`          |

The 403 is expected when the formation member has no writer access on the chosen parent.

Both write guards use the strict membership check (`isFormationTeamMemberStrict`, backed by `checkSingleAccessStrict`): the accept pre-check, and the revise staff-key guard described below. If the access check is unavailable, the write aborts before anything is sent upstream, and the upstream error passes through to the caller (for example a 503). An outage is never treated as "not a member". As a result, a stored parent is never silently dropped, and an outage never shows up as a 403.

Only the browser's `GET /access` probe uses the lenient `isFormationTeamMember` (`checkSingleAccess`). It reads an outage as "not a member", so the Project proposals tab stays hidden.

Upstream, `parent_project_uid`, `project_slug` and `project_uid` are ordinary answer keys that any `writer` can change. `PROJECT_APPLICATION_STAFF_KEYS` lists them, and the BFF strips them:

- from every create
- from any revise sent by a caller outside the formation team; the revise itself still goes through

This stops a submitter from placing their own project, or from planting a `project_uid` that would make accept skip the create. Dropping the keys, rather than refusing the revise, keeps the submitter able to edit their own proposal after an accept that recorded the keys but then failed.

Because accept can fail after an earlier write, the UI never retries an accept. A 404 drops the application. Any other failure is treated as a stale revision and reloads.

## Validation and privacy

`validateProjectApplicationAnswers` (shared utils) mirrors formation-service's canonical-field rules, so a bad payload gets a field-specific 400 before any upstream call. Unknown keys are kept as they are.

Answers, emails and upstream messages are never logged. Logs carry only non-sensitive metadata: uid, state, revision, upstream status and reason, counts, and formation-team membership. Read responses are `Cache-Control: private, no-store`.
