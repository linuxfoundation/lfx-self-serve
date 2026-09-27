<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Project Applications BFF

"Propose a project" (#3037) lets any signed-in user submit a project application. The LF formation team then reviews it. The backend is `lfx-v2-formation-service`'s `/project-applications` routes (#1962). Reads go through query-service.

## Routes

Everything is mounted at `/api/project-applications` (`routes/project-applications.route.ts`). The global `authMiddleware` requires a session for every route. Writes also use `blockDuringImpersonation`.

| Route                           | Upstream                                                                          | Token   |
| ------------------------------- | --------------------------------------------------------------------------------- | ------- |
| `GET /mine`                     | `GET /query/resources?type=project_application&tags=submitter:<username>`         | user    |
| `GET /queue`                    | `GET /query/resources?type=project_application` (no project-tree filter)          | user    |
| `GET /access`                   | access-check `team:formation#member`                                              | user    |
| `POST /`                        | `POST /project-applications`                                                      | **M2M** |
| `PUT /:uid`                     | `PUT /project-applications/{uid}` (`If-Match`)                                    | user    |
| `POST /:uid/withdraw` · `/deny` | `POST /project-applications/{uid}/withdraw` · `/deny` (`If-Match`)                | user    |
| `POST /:uid/accept`             | `PUT /project-applications/{uid}`, then `POST /project-applications/{uid}/accept` | user    |
| `DELETE /:uid`                  | `DELETE /project-applications/{uid}` (`If-Match`, 204)                            | user    |

## Why create uses M2M

This is a deliberate, approved exception, not an instance of the existing "explicit privileged upstream call" case in `.claude/rules/development-rules.md`. That case requires an in-app authorization check first; here there is none beyond "has a session", because any signed-in user may propose.

The formation-service contract has the UI authenticate **as itself** on create. The gateway admits only `team:global_project_application_admin`, and the self-serve M2M principal is the member of that team. That way any signed-in user can propose a project without needing a per-user grant.

What keeps the exception narrow:

- The route requires a session and refuses impersonation.
- The M2M token is scoped to this one call with `{ bearerToken }`.
- The submitter's `username`, `name` and `email` are copied from the session into the payload, so the application is attributable to the person who submitted it. The browser only ever sends `application`, and `parent_project_uid` is stripped from it.
- Every other route uses the caller's own token.

## Concurrency

Every mutation after create forwards the application's `revision` as a bare-digit `If-Match`, checked by `parseIfMatch`. Upstream returns the next revision in `ETag`, and the BFF passes it through.

A `412` becomes `PreconditionFailedError`. The UI never replays a write after a 412; it reloads and lets the user try again.

query-service lags behind successful writes. The UI therefore records each write result in an overlay in the root-scoped browser `ProjectApplicationService`, kept per list mode (`submitter` / `staff`), and applies it to every read instead of refetching straight away. Because the overlay is root-scoped, it survives a tab switch that destroys the list. `reconcile` prunes an entry once a read returns the same or a newer revision, or stops returning a deleted UID.

A 404 on any write means the application is gone: the UI drops it from the list (`recordDeleted`) rather than reloading.

## Accept and the parent project

The upstream accept route takes no body. Per #3037, the formation team chooses the parent project when accepting, and the new project is created downstream from the accepted application. Accept therefore runs as an access pre-check followed by two formation-service writes:

1. The BFF checks that the caller is in `team:formation`. This is a guard, not the authorization: revise only needs `writer`, so a submitter could otherwise commit the revise and then be refused the accept.
2. It revises the complete answer map, adding `application.parent_project_uid`.
3. It accepts at the revision the revise returned.

Both write guards — the accept pre-check and the revise parent-key guard below — use the strict membership check (`isFormationTeamMemberStrict`, backed by `checkSingleAccessStrict`). If the access check is unavailable, the write aborts before anything is sent upstream and the upstream error passes through to the caller (for example a 503). It is never treated as "not a member", so a stored parent is never silently dropped and an outage never shows up as a 403. Only the browser's `GET /access` probe uses the lenient `isFormationTeamMember` (`checkSingleAccess`), which reads an outage as "not a member" so the Project proposals tab stays hidden.

Upstream, `parent_project_uid` is an ordinary answer key that any `writer` can change. The BFF strips it from every create. When a revise carries it and the caller is not on the formation team, the BFF drops the key and still sends the revise. Refusing instead would lock the submitter out of their own proposal after an accept that recorded the parent but then failed. Because accept can fail after that first write, the UI never retries an accept: a 404 drops the application, and any other failure is treated as a stale revision and reloads.

## Validation and privacy

`validateProjectApplicationAnswers` (shared utils) mirrors formation-service's canonical-field rules, so a bad payload gets a field-specific 400 before any upstream call. Unknown keys are kept as they are.

Answers, emails and upstream messages are never logged. Logs carry only non-sensitive metadata: uid, state, revision, upstream status and reason, counts, and formation-team membership. Read responses are `Cache-Control: private, no-store`.
