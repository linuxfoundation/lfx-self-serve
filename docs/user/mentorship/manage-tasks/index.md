---
title: Create and Assign Tasks
description: How a Program Admin or mentor creates, assigns and edits LFX Mentorship tasks.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, mentor, tasks, assign, due-date, file]
last_generated: 2026-10-26
last_updated: 2026-10-26
intercom_collection: Mentorship
---

Tasks are how a program gives a mentee work and tracks it. Program Admins and the program's mentors can both create and edit them.

## Before you begin

- You must be a Program Admin or an approved mentor on the program.
- The mentee must be accepted on the term before they can be given non-prerequisite tasks.

## The task form

| Field                | Notes                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Task Name**        | Up to 120 characters, e.g. "Submit ingestion benchmark report"                                                      |
| **Due Date**         | `yyyy-mm-dd`                                                                                                        |
| **Task Description** | Up to 1,000 characters. What should the mentee do, and how will you know it is done?                                |
| **Task Status**      | The status the task starts in                                                                                       |
| **Requires a file**  | Tick "Completion of this task requires that the mentee submits a file" to block submission until a file is uploaded |
| **Assign to**        | One or more mentees. **Select all** and **Clear** act on the whole list                                             |

## Steps

Where you create a task depends on your role. In both cases it is the mentee list, not the Tasks tab.

### As a Program Admin

1. Open the program from [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin).
2. Go to **Current Mentees** and use the **Create task** row action on the mentee.
3. Fill in the form and select **Add Task**.

### As a mentor

1. Open the program from **My Programs** and go to the **Mentees** tab.
2. For one mentee, use the **+** on their row. For several, use **Create Group Task** above the table and pick the assignees.
3. Fill in the form and select **Add Task**.

The **Assign to** list only appears when you are creating a group task. A per-row create is assigned to that mentee already.

### Change a task

Expand the mentee's row with **View Tasks**, use **Edit Task**, then **Save Task**. A task's assignee cannot be changed after it is created, and tasks cannot be deleted, so create a separate task for anyone else who needs it.

A mentor's **Tasks** tab offers **Approve** and **Request Changes** only; it does not create or edit tasks.

A task can be assigned to up to 100 mentees in one request; a larger group is sent in batches.

## Task status

| Status          | What it means                |
| --------------- | ---------------------------- |
| **Pending**     | Not started                  |
| **In Progress** | The mentee is working on it  |
| **Submitted**   | Handed in, waiting on review |
| **Completed**   | Accepted by a reviewer       |

## Troubleshooting

| What you see                                                                              | What it means                                                                                                         |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "Some tasks were not created"                                                             | The task was created for some of the mentees you picked, not all. Check the rows.                                     |
| "The task may not have been created. Check the mentee's row before trying again."         | The request failed without a clear answer. Look at the row before retrying — a second attempt can create a duplicate. |
| "This mentee can no longer be given tasks."                                               | They are no longer accepted on the term.                                                                              |
| "You can no longer create tasks on this program."                                         | You are no longer an admin or mentor on it.                                                                           |
| "A task that requires a file can only be submitted once a file has been uploaded for it." | The mentee has not uploaded the required file yet.                                                                    |
| "This task no longer exists."                                                             | The task is no longer on the program. Refresh the page and work from the reloaded list.                               |

## Related

- [Review Applicants and Tasks](../mentor-program-detail/)
- [Review Applications and Decide](../review-applications/)
- [Complete Your Tasks](../mentee-tasks/) — what the mentee sees
