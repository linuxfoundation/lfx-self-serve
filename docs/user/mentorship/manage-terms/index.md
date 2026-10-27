---
title: Manage Terms
description: How a Program Admin creates and manages the terms of an LFX Mentorship program.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, terms, schedule, open, closed]
last_generated: 2026-10-26
last_updated: 2026-10-26
intercom_collection: Mentorship
---

A **term** is a dated run of a program. Applications are always made to a term, not to the program as a whole. Only a Program Admin can create or change a term.

## Before you begin

- You must be a Program Admin on the program.
- A program may have at most **4 open terms** at once.

## Steps

1. Open [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin) and select the program.
2. Go to the **Terms** tab.
3. Create a term, choosing a standard period or defining a custom one. A term name is up to 50 characters.
4. Edit or delete a term from its row. Deleting asks you to confirm, and is only offered while the term has no applications.
5. Close a term from its row once it has no accepted applicants, or re-open a closed term that has not ended yet. Closing declines the term's pending applications (see below).

The tab is paged ten terms at a time.

## Term status

| Status     | What it means                                      |
| ---------- | -------------------------------------------------- |
| **Open**   | The term is live                                   |
| **Closed** | The term is finished and takes no new applications |

**Open does not by itself mean the term is accepting applications.** A term has its own application start and end dates, and the apply page checks those separately. A running term whose application window has ended stays **Open** but turns applicants away, so set the dates to define the window rather than relying on the status.

**Current Mentees** covers open terms; **Past Mentees** covers closed ones.

## Closing a term

Closing is not a quiet way to free a slot. Before you close one:

- **Every pending application is declined automatically.** The confirmation says so: "Closing this term will automatically decline all pending applications. Continue?"
- **A term with accepted applicants cannot be closed at all.** You are told: "This term cannot be closed until all accepted applicants are either graduated or declined. Please ensure there are zero accepted applicants before closing the term." Graduate or decline them first.

A closed term that has not yet ended can be re-opened, as long as the program is under its four-open-term limit.

## Troubleshooting

| What you see                                                                                    | What it means                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| "We could not load the terms. Try again."                                                       | A transient failure reading the term list.                                    |
| "Are you sure you want to delete this term?"                                                    | Deleting a term is confirmed before it happens.                               |
| You cannot add another open term                                                                | The program already has four. Close one first.                                |
| "This term cannot be closed until all accepted applicants are either graduated or declined."    | The term still has accepted mentees. Graduate or decline them before closing. |
| "This term should be closed because it has ended. Please close it to prevent new applications." | The term's end date has passed while it is still open.                        |

## Related

- [Review Applications and Decide](../review-applications/)
- [Enroll a Program](../enroll-a-program/)
