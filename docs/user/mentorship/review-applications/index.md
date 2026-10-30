---
title: Review Applications and Decide
description: How a Program Admin accepts, declines, withdraws or graduates an LFX Mentorship application.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, applications, accept, decline, graduate, withdraw, mentees]
last_generated: 2026-10-26
last_updated: 2026-10-26
intercom_collection: Mentorship
---

The **Current Mentees** tab is where a Program Admin decides on applications for the program's open terms. **Past Mentees** shows the same for closed terms.

![A program’s Current Mentees tab, with status, other applications and actions per mentee](/images/docs/mentorship/review-applications.png)

## Before you begin

- You must be a Program Admin on the program.
- Open the program from [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin).

## Steps

1. Go to the **Current Mentees** tab.
2. Narrow the list with the search box, the status filter (**All statuses**, or one status) and the term filter (**All open terms**, or one term).
3. Select **View Tasks** on the row to expand the applicant's prerequisite tasks and download anything they submitted. Use **Add note**, or the note already on the row, for reviewer notes.

   The row and the applicant's name do not open a profile page — what you review is their tasks and the notes on the row.

4. Use the row actions:

   | Action          | What it does                                                                                       |
   | --------------- | -------------------------------------------------------------------------------------------------- |
   | **Accept**      | Puts the applicant on the term. You must choose an attendance type: **Full time** or **Part time** |
   | **Decline**     | Turns the application down. The mentee is told it was declined                                     |
   | **Withdraw**    | Pulls the application on the mentee's behalf. This cannot be undone                                |
   | **Graduate**    | Marks an accepted mentee as having completed the term                                              |
   | **Create task** | Assigns work. See [Create and Assign Tasks](../manage-tasks/)                                      |

5. Confirm in the dialog.

The tab is paged ten mentees at a time, and the search waits briefly after your last keystroke before running.

## Applicant status

| Status              | What it means                               |
| ------------------- | ------------------------------------------- |
| **Applied**         | Submitted; prerequisites not all finished   |
| **Tasks Completed** | Prerequisites finished, awaiting a decision |
| **Accepted**        | On the term                                 |
| **Declined**        | Turned down                                 |
| **Withdrawn**       | Pulled by the mentee, or on their behalf    |
| **Graduated**       | Finished the term                           |

## Decline by term

**Decline by Term** declines every pending application in one term at once. Accepted mentees are not affected. You pick the term, then confirm — this cannot be undone.

If there is no open term, the dialog says so instead.

## Graduating a mentee

If the mentee still has tasks that are not Submitted or Completed, the confirmation says how many. You can still graduate them.

## Troubleshooting

| What you see                                                  | What it means                                                         |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| "This application changed. The list has been refreshed."      | Someone else decided first. Check the new status before acting again. |
| "This term is closed, so the application can't be accepted."  | The term closed while you were looking.                               |
| "Another change is still being saved. Try again in a moment." | One decision at a time.                                               |
| "Choose an attendance type to accept the application."        | Accept requires **Full time** or **Part time**.                       |
| "The change couldn't be saved. Please try again."             | A transient failure; nothing changed.                                 |

## Related

- [Create and Assign Tasks](../manage-tasks/)
- [Leave a Reviewer Note](../reviewer-notes/)
- [Export Mentees](../export-mentees/)
- [Manage Terms](../manage-terms/)
