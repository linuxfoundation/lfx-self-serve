---
title: Complete Your Tasks
description: How to work through LFX Mentorship tasks, change a task's status and upload a required file.
audience: [all]
product_area: Mentorship
tags: [mentorship, mentee, tasks, status, file-upload, prerequisites]
last_generated: 2026-10-26
last_updated: 2026-10-30
intercom_collection: Mentorship
---

The **My Tasks** tab holds everything a program has assigned you — the prerequisites attached to an application, and the term's work once you are accepted.

![My Tasks, listing prerequisite tasks with their status and upload buttons](/images/docs/mentorship/mentee-tasks.png)

## Before you begin

- Sign in at [app.lfx.dev](https://app.lfx.dev) and go to **Mentorship → Mentee → My Tasks**.
- You need at least one application with tasks on it.

## Task status

You set a task's status yourself from the status menu on its row, but only certain moves are allowed:

| Status          | What it means                       | Where you can move it                                           |
| --------------- | ----------------------------------- | --------------------------------------------------------------- |
| **To Do**       | Not started                         | To **In Progress**                                              |
| **In Progress** | You are working on it               | To **Submitted** — or upload the file, which submits it for you |
| **Submitted**   | Handed in for your mentor to review | Back to **In Progress**, until the due date passes              |

**Submitted** is greyed out on a task still in **To Do** — start it first. You cannot move a task back to **To Do** once it is under way.

A mentor or Program Admin may also move a task on their side; your view refreshes to match. Once your mentor marks a task complete, it still shows as **Submitted** to you, and the status menu locks: "Completed tasks can only be changed by your mentor."

## Steps

1. Open [app.lfx.dev/mentorship/mentee/tasks](https://app.lfx.dev/mentorship/mentee/tasks).
2. Pick the application whose tasks you want. Prerequisite tasks and term tasks are listed separately.
3. Use the filter chips — **All**, **To Do**, **In Progress**, **Submitted** — to narrow the list.
4. Open a task to read what it asks for and when it is due.
5. Set the task to **In Progress**.
6. Finish it:
   - **A task that needs a file** — upload the file. That submits the task; there is no separate step.
   - **Any other task** — set it to **Submitted** yourself.

## Tasks that require a file

**Uploading the file submits the task.** There is no draft state: once the upload succeeds the task moves to **Submitted** and your mentor can review it. Upload only when the work is ready to hand in.

You can upload one PDF, DOC, DOCX or plain-text file, up to 20 MB. A larger file is refused with "The file is larger than 20 MB."

Until you upload, **Submitted** stays disabled and the row shows:

> This task needs a file before it can be submitted. Upload one first.

Afterwards:

| You want to          | You can, while                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| **Replace** the file | Your mentor has not completed the task and the due date has not passed |
| **Remove** the file  | The task is not submitted yet and the due date has not passed          |

Because the upload submits the task, **Remove** disappears straight after it. To take a submission back, move the task to **In Progress** first, then remove or replace the file.

## Tasks that are past due

After the due date you can still start a task and work on it, but **Submitted** is disabled:

> The due date has passed, so this task can no longer be submitted.

A task you already submitted cannot be reopened after the due date either:

> The due date has passed, so this submission can no longer be reopened.

Contact your mentor or the Program Admin if you need a task reopened.

## Troubleshooting

Each of these appears as a short message on screen, and your task list reloads so it matches what the program sees.

| What you see                                                                                                                                 | What it means                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| "This task no longer exists. Your tasks have been refreshed."                                                                                | The Program Admin removed this prerequisite from the program. |
| "This task could not be updated. If it needs a file, upload one first. Your tasks have been refreshed."                                      | The move was refused — most often a missing required file.    |
| "This task has already moved on, so your change was not applied. Your tasks have been refreshed."                                            | Someone else changed the task first.                          |
| "You do not have permission to update this task right now. If it is assigned to you, try again in a moment. Your tasks have been refreshed." | A permissions check failed; try again shortly.                |
| "The due date for this task has passed, so it can no longer be submitted or reopened."                                                       | You tried to submit or reopen a task after its due date.      |

## Related

- [Track Your Applications](../mentee-overview/)
- [Mentorship FAQ](../faq/)
