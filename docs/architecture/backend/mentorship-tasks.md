<!-- Copyright The Linux Foundation and each contributor to LFX. -->
<!-- SPDX-License-Identifier: MIT -->

# Mentorship Task Writes

Admins and mentors manage a mentee's tasks the same way, so both program details write tasks through one role-neutral layer: one pair of BFF routes, one controller and service, one helper, and one app service per write (linuxfoundation/lfx-mentorship#273). Upstream decides who may make each write, a program admin or an active mentor of the program, so there is no route per role. Mentor review (Approve and Request Changes) stays on the mentor router, since only the mentor Tasks tab offers it (see [Task reviews](./mentorship-mentor.md#task-reviews)).

## Routes

| Method | Path                            | Controller method | Page                                                                                         |
| ------ | ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/api/mentorship/tasks`         | `createTasks`     | Create task on admin Current Mentees; Create and Create Group Task on the mentor Mentees tab |
| PATCH  | `/api/mentorship/tasks/:taskId` | `updateTask`      | Edit and the status select on an expanded task row, on every page that shows the task panel  |

Both are behind `blockDuringImpersonation` and use the caller's bearer token. `taskId` must be a UUID; anything else is a 400.

## Flow

```text
CurrentMenteesTabComponent (admin) · MentorProgramDetailComponent (mentor) · ApplicantTasksPanelComponent
  → MentorshipTaskCreateService · MentorshipTaskUpdateService (app, toasts and in-flight state)
  → MentorshipService (app)                   POST /api/mentorship/tasks · PATCH /api/mentorship/tasks/:taskId
      → mentorship.route.ts                   router.use('/tasks', taskRouter)
      → mentorship-task.route.ts              blockDuringImpersonation
      → MentorshipTaskController              401 with no signed-in user · 400 for a bad body or task id
      → MentorshipTaskService (server)        helpers in mentorship-task.helper.ts
  ← JSON
```

| Layer        | File                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared types | `MentorshipTaskCreateRequest`, `MentorshipTaskCreateResponse`, `MentorshipTaskUpdate` in `mentorship.interface.ts`                                         |
| Shared copy  | `MENTORSHIP_TASK_CREATE_*` and `MENTORSHIP_TASK_UPDATE_*` in `mentorship.constants.ts`                                                                     |
| BFF          | `routes/mentorship-task.route.ts`, `controllers/mentorship-task.controller.ts`, `services/mentorship-task.service.ts`, `helpers/mentorship-task.helper.ts` |
| App          | `MentorshipService` (HTTP), `MentorshipTaskCreateService`, `MentorshipTaskUpdateService`                                                                   |

## Create

`POST /api/mentorship/tasks` gives one accepted mentee a task, or the same task to several. Upstream has no batch create, so the BFF writes one task per application.

```text
POST /tasks { applicationIds, name, description, dueDate?, requiresFileSubmission? }
  → 1 to MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS application UUIDs (lowercased, a repeat dropped; refused at the first id past the cap), else 400
  → name and description required after trimming, within MENTORSHIP_TASK_NAME_MAX / MENTORSHIP_TASK_DESCRIPTION_MAX, else 400
  → dueDate a calendar YYYY-MM-DD when set, requiresFileSubmission a boolean when set, else 400
  → GET /mentorship/v1/me                           (the caller's local user id, read once)
  → per application, at most MENTORSHIP_TASK_CREATE_CONCURRENCY at once:
      GET  /mentorship/v1/applications/{id}         (must be an accepted mentee's, else 400)
      POST /mentorship/v1/applications/{id}/tasks   { assignee_id, program_term_id, owner_id, created_by, name, description,
                                                      category: non_prerequisite, custom: true, due_date?, submit_file? }
  ← 200 { created, failed }
```

- **What the browser sends.** Only the application ids and the task's text, due date and file flag. The assignee and term come from the application upstream returns, and the owner and author are the caller's local user id, so none of them is taken from the browser. A task made here is always a custom, non-prerequisite task; a required file is sent as `submit_file: 'required'`.
- **Who can be given a task.** Upstream takes a task only on an accepted mentee's application, so the BFF refuses a graduated, withdrawn or mentor application (`isMentorshipTaskAssignableApplication`) before writing.
- **One application or many.** With one application, a failure passes through with its status (403, 404, 409). With several, each runs on its own (`Promise.allSettled`), and the 200 lists the ids in `created` and `failed` in request order; each failure logs a warning with the application id, status and code.
- **App side.** `MentorshipTaskCreateService` owns the toasts: `MENTORSHIP_TASK_CREATE_SUCCESS_SUMMARY` (naming the count for a group), `MENTORSHIP_TASK_CREATE_PARTIAL_SUMMARY` as a warning when some failed (naming the missed mentees), an error when none was created, and for a failed request `MENTORSHIP_TASK_CREATE_ERROR_MESSAGES` for a 400, 403 or 404, the server's message for the impersonation 403, else the fallback. Upstream's create is not idempotent, and a failure without a status of its own (a timeout, a 5xx) may still have created the task, so every failure copy sends the caller to the row rather than to a retry. A group past `MENTORSHIP_TASK_CREATE_MAX_APPLICATIONS` is sent in batches of that size, one after another, with a failed batch counting its mentees as failed. The service tracks the applications getting a task (`isCreating(id)`), so a tab rebuilt while a create is running sends nothing for them. The create is not tied to the page, so it and its toast finish if the caller leaves first.
- Logs carry the application count and the created and failed counts only, never the task's name or description.

## Edit and set status

`PATCH /api/mentorship/tasks/:taskId` changes one task. Upstream is `PATCH /mentorship/v1/tasks/{id}` (lfx-mentorship#227), which allows an active mentor of the program or a program admin, never the task's assignee.

- The body is `MentorshipTaskUpdate`: every field is optional and an absent one is left unchanged, but at least one is required. The status select sends `status` alone; the edit dialog sends only what it changed, diffed against the row by `buildMentorshipTaskUpdate` in `@lfx-one/shared/utils`. The body check is `parseMentorshipTaskUpdate` and the upstream body is `buildMentorshipUpstreamTaskUpdate`. `status` goes through `MENTORSHIP_TASK_STATUS_TO_UPSTREAM`, `requiresFileSubmission` maps to `submit_file` (`required`, or `''` to clear it) and an empty `dueDate` clears the due date.
- Upstream lets a status move to any other status. A task that requires a file cannot be Submitted without an uploaded file, whether it is moving to Submitted or gaining the file requirement, and upstream answers that with a 400. That 400 gets its own copy only for a change that can trip the guard (a move to Submitted or a change to the file requirement); any other 400 shows the generic copy. A 403 and a 404 each have their own copy, and any other failure shows the generic one. A failed change leaves the row as it was.
- The answer is 200 with the task as the row reads it, so the page writes it into its row instead of reading the list again. The task panel hands it to its `taskSaved` callback, a callback rather than an output so a save that lands after its row collapsed still reaches the page.
- `MentorshipTaskUpdateService` tracks the tasks being saved: a task with a change in flight takes no second change, and its select and Edit are disabled. The in-flight ids are a signal, so a panel rebuilt mid-save keeps both disabled and re-enables them when the save settles, whether it succeeded or failed.
- Logs carry the task id and the names of the fields changed, never the task's text.

What each page does with a create or a saved task is described with the page: [admin Current Mentees](./mentorship-admin.md#task-writes) and [the mentor program detail](./mentorship-mentor.md#tasks).
