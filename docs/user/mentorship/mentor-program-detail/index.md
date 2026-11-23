---
title: Review Applicants and Tasks
description: How a mentor reviews applicants, manages tasks and records notes on a program they mentor.
audience: [all]
product_area: Mentorship
tags: [mentorship, mentor, applicants, tasks, review, notes]
last_generated: 2026-10-26
last_updated: 2026-11-10
intercom_collection: Mentorship
---

A program's detail page is where a mentor does their day-to-day work: reading applicants, setting and reviewing tasks, and recording notes for the other reviewers.

![A mentor’s Applicants tab for a program, with status filters](/images/docs/mentorship/mentor-program-detail.png)

## Before you begin

- You must be an approved mentor on the program. See [Your Mentor Programs](../mentor-programs/).
- Open the program from **My Programs**.

## The tabs

The page opens on **Tasks**. Each tab shows a count.

| Tab            | What it holds                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| **Tasks**      | Tasks your mentees submitted for review, and the ones you approved                              |
| **Mentees**    | The **Current Mentees** accepted onto the program, with task progress — where tasks are created |
| **Applicants** | People who applied, with search, a status filter, their other active applications and notes     |

## Review an applicant

1. Open [app.lfx.dev/mentorship/mentor/programs](https://app.lfx.dev/mentorship/mentor/programs) and select a program.
2. On **Applicants**, search by name or email, or filter with the status pills — **Pending** (the default), **Accepted**, **Declined** or **All**.
3. Select **View Tasks** on the row to expand their prerequisite tasks. Next to a submitted file, the eye icon opens it in a new tab and the download icon saves it.
4. Select **Add note**, or the existing note on the row, to record context for the other reviewers. See [Leave a Reviewer Note](../reviewer-notes/).

Select an applicant's name to open their public mentee page in a new tab. The row itself does not open anything, and there is no cover letter to read — what you review is their tasks and the notes on the row. The **Other Active Applications** column shows the other programs they have live applications on.

## Contact a mentee

Select the envelope icon on a row, on **Applicants** or **Mentees**, to open an email to that mentee in your mail app. It is offered whatever the mentee's status.

## Create a task

Tasks are created from the **Mentees** tab, under **Current Mentees**, not the Tasks tab, and only for an accepted mentee:

- **One mentee** — use the **+** on their row. The task is assigned to them, with no assignee to choose.
- **Several mentees** — use **Create Group Task** above the table, then pick the assignees, with **Select all** and **Clear** to hand.

To change a task, expand the mentee's row with **View Tasks** and use **Edit Task**. A task's assignee cannot be changed after it is created.

## Review a submitted task

1. Open the **Tasks** tab.
2. Filter with the pills — **Awaiting Review** (the default), **Approved** or **All**.
3. Read the task card: who submitted or completed which task, the term, when it was last updated, and the task description.
4. If the mentee uploaded a file, select **View Submission** to open it in a new tab, or **Download Submission** to save it.
5. On a submitted task, select **Approve**, or select **Request Changes**, enter a reason, and select **Request Changes** in the dialog.

PDF and plain-text files open in the browser. A DOC or DOCX file cannot be shown there, so **View Submission** (or the eye icon on Applicants and Mentees) downloads it instead and says so.

This tab is for reviewing only — you cannot create or edit a task here.

Approving a task locks it for the mentee: from then on only a mentor can change it. It moves under **Approved**.

**Request Changes** asks for a reason: what the mentee should change before they submit the task again. The reason is required. The task goes back to the mentee as **To Do**, and the mentee is emailed the reason. The reason is not saved on the task, so the email is the only place the mentee sees it. Select **Cancel** to close the dialog without sending the task back.

## Applicant task status

| Status          | What it means                                       |
| --------------- | --------------------------------------------------- |
| **Pending**     | Not started                                         |
| **In Progress** | The mentee is working on it                         |
| **Submitted**   | Handed in, waiting on your review                   |
| **Completed**   | You approved it; the mentee can no longer change it |

## Troubleshooting

| What you see                                      | What it means                                                 |
| ------------------------------------------------- | ------------------------------------------------------------- |
| "You can no longer edit tasks on this program."   | You are no longer an approved mentor on it. Refresh the page. |
| "This application no longer exists."              | The applicant withdrew, or the application was removed.       |
| "This task is no longer awaiting review."         | It was already reviewed or changed. The tab reloads.          |
| "You can no longer review tasks on this program." | You are no longer an approved mentor on it.                   |

## Related

- [Create and Assign Tasks](../manage-tasks/)
- [Leave a Reviewer Note](../reviewer-notes/)
- [Review Applications and Decide](../review-applications/) — the Program Admin's decision actions
