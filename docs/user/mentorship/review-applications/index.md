---
title: Review Applications and Decide
description: How a Program Admin accepts, declines, withdraws or graduates an LFX Mentorship application, and walks back a graduation, decline or withdrawal.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, applications, accept, decline, graduate, undo-graduation, re-open, withdraw, mentees]
last_generated: 2026-10-26
last_updated: 2026-11-09
intercom_collection: Mentorship
---

The **Current Mentees** tab is where a Program Admin decides on applications for the program's open terms. **Past Mentees** shows the same for closed terms.

![A program’s Current Mentees tab, with status, other applications and actions per mentee](/images/docs/mentorship/review-applications.png)

## Before you begin

- You must be a Program Admin on the program.
- Open the program from [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin).

## Steps

1. Go to the **Current Mentees** tab.
2. Narrow the list with the **Search** box, the **Filter By Status** filter (**All statuses**, or one status) and the **Filter by Term** filter (**All open terms**, or one term). On **Past Mentees** the term filter offers **All closed terms**.
3. Select **View Tasks** on the row to expand the applicant's prerequisite tasks. Next to a submitted file, the eye icon opens it in a new tab (a DOC or DOCX file downloads instead) and the download icon saves it. Use **Add note**, or the note already on the row, for reviewer notes.

   On an approved program (**Accepting**, **In Progress**, **Upcoming** or **Completed**), the applicant's name links to their public mentee page, which opens in a new tab. On any other program the name is not a link. The row itself does not open anything.

4. Use the row actions:

   | Action              | What it does                                                                                                          |
   | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
   | **Accept**          | Puts the applicant on the term. You must choose an attendance type: **Full time** or **Part time**                    |
   | **Decline**         | Turns the application down. The mentee is told it was declined                                                        |
   | **Withdraw**        | Pulls the application on the mentee's behalf. You can **Re-open** it later                                            |
   | **Graduate**        | Marks an accepted mentee as having completed the term                                                                 |
   | **Undo graduation** | Moves a graduated mentee back to **Accepted**. See [Undoing a graduation](#undoing-a-graduation)                      |
   | **Re-open**         | Moves a declined or withdrawn application back to review. See [Re-opening an application](#re-opening-an-application) |
   | **Create task**     | Assigns work. See [Create and Assign Tasks](../manage-tasks/)                                                         |
   | **Contact Mentee**  | Opens an email to the mentee in your mail app. Offered at every status, and asks for no confirmation                  |

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

**Decline by Term** declines every pending application in one term at once. Accepted mentees are not affected. You pick the term, then confirm. To bring an application back, **Re-open** it on its own row.

If there is no open term, the dialog says so instead.

## Graduating a mentee

If the mentee still has tasks that are not Submitted or Completed, the confirmation says how many. You can still graduate them.

## When an action is refused

Accept, Graduate, Undo graduation and Re-open can be refused because of the program, the term or the mentee's other applications. The error message says which: for example, "This application can't be accepted: the mentee is already accepted in another mentorship that hasn't ended." A mentee can hold only one accepted mentorship at a time, none of these actions works while the program is hidden, and Accept, Undo graduation and Re-open need the term to be open.

## Undoing a graduation

If you graduated a mentee by mistake, pick **Undo graduation** on their row and confirm. The mentee goes back to **Accepted** with the attendance type they had, and from there the usual actions apply again: you can graduate or decline them. No email is sent, and the graduation email they already received is not recalled.

A mentee can hold only one accepted mentorship at a time, so the undo is refused if they have since been accepted in another program. It is also refused once the term is no longer open, or while the program is hidden.

## Re-opening an application

If an application was declined or withdrawn by mistake, pick **Re-open** on its row and confirm. The application goes back to review, as **Applied** or **Tasks Completed**, and you can decide on it again. No email is sent.

A re-opened application is checked like a new one: it can't be re-opened while the program is hidden, once the term is closed, or while the mentee already has three applications under review. Its existing tasks stay as they were, and if the program added a prerequisite while it was closed, a task for it is added.

## Troubleshooting

| What you see                                                                                                                  | What it means                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This application changed. The list has been refreshed."                                                                      | Someone else decided first. Check the new status before acting again.                                                                                    |
| "This application can't be accepted: the mentee is already accepted in another mentorship that hasn't ended."                 | A mentee can hold only one accepted mentorship at a time. See [When an action is refused](#when-an-action-is-refused).                                   |
| "This application can't be accepted: the term is closed."                                                                     | The term closed while you were looking.                                                                                                                  |
| "…: the program is hidden. Unhide it, then try again."                                                                        | Select **Unhide Program** first; see [Hide or Show a Program](../program-visibility/).                                                                   |
| "Another change is still being saved. Try again in a moment."                                                                 | One decision at a time.                                                                                                                                  |
| "This graduation can't be undone: …"                                                                                          | The message names the reason. See [Undoing a graduation](#undoing-a-graduation).                                                                         |
| "This application can't be re-opened: …"                                                                                      | The message names the reason. See [Re-opening an application](#re-opening-an-application).                                                               |
| A message that lists several reasons, such as "the program is hidden, the term is closed, or …"                               | The action was refused, but the service didn't say which of these applies. Check each one.                                                               |
| "This application can't be re-opened: it changed, or the mentee has applied to this term again. The list has been refreshed." | The mentee has applied to the term again since withdrawing, so their newer application is the one to decide on. Otherwise someone else changed it first. |
| "Choose an attendance type to accept the application."                                                                        | Accept requires **Full time** or **Part time**.                                                                                                          |
| "The change couldn't be saved. Please try again."                                                                             | A transient failure; nothing changed.                                                                                                                    |

## Related

- [Create and Assign Tasks](../manage-tasks/)
- [Leave a Reviewer Note](../reviewer-notes/)
- [Export Mentees](../export-mentees/)
- [Manage Terms](../manage-terms/)
