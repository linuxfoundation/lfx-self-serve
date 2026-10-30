---
title: Hide or Show a Program
description: How a Program Admin hides an LFX Mentorship program from public view, makes it visible again, and opens its public page.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, hide, unhide, visibility, public-page, program]
last_generated: 2026-10-30
last_updated: 2026-10-30
intercom_collection: Mentorship
---

These steps apply to Program Admins.

Hiding a program takes it out of public view: mentees can no longer find it or apply. Its status becomes **Hidden**. You can make it visible again at any time.

## Before you begin

- You must be a Program Admin on the program.
- Only an **Open** or **Completed** program can be hidden. A program in **Pending Review** or **Rejected** has neither action.
- A program with active applications cannot be hidden.

## Hide a program

1. Open the program from [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin).
2. Open the **⋯** menu next to **Edit Program**.
3. Select **Hide Program**.
4. Select **Hide** in the confirmation dialog.

You see **Program hidden.** and the status badge changes to **Hidden**.

## Show a hidden program again

1. Open the program.
2. Open the **⋯** menu next to **Edit Program**.
3. Select **Unhide Program**.
4. Select **Unhide** in the confirmation dialog.

You see **Program unhidden.** The program is publicly visible again.

## View the public page

**View Public Page**, next to **Edit Program**, opens the program's page on [mentorship.linuxfoundation.org](https://mentorship.linuxfoundation.org) in a new tab. It shows on every program, whatever its status.

## Troubleshooting

| What you see                                                                           | What it means                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "This program can't be hidden: it has active applications, or its status has changed." | Nothing was hidden. The page has been refreshed, so check the program's status and applications. |
| "This program can't be made visible: its status has changed."                          | Nothing changed. The page has been refreshed with the program's current status.                  |
| "The program's visibility couldn't be changed. Please try again."                      | A transient failure; nothing changed.                                                            |

## Related

- [Your Programs (Program Admin)](../admin-programs/)
- [Review Applications and Decide](../review-applications/)
- [Mentorship FAQ](../faq/)
