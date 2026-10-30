---
title: Enroll a Program
description: How a Program Admin enrolls a Linux Foundation project's mentorship program in LFX Self Serve, step by step.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, enroll, program, logo, terms, prerequisites, review]
last_generated: 2026-10-26
last_updated: 2026-10-30
intercom_collection: Mentorship
---

Enrollment is a three-step form that submits a program for Linux Foundation review. Nothing is saved until you submit on the final step — moving between steps only validates them — so the form warns you before you leave with unsaved answers. Set aside enough time to finish it in one sitting.

## Before you begin

- You must be signed in at [app.lfx.dev](https://app.lfx.dev) and be a Program Admin for the Linux Foundation project.
- Have a program logo ready: **JPG or PNG, 420 × 420 px, 2 MB maximum**. SVG is not accepted.
- Scope the work for a single term and confirm funding first.
- Mentors are **not** invited here. You invite them from the Mentors tab once the program is approved.

## Step 1 — Program Details

Describe the program and the project it belongs to. This is what candidates read on your program page. Fields marked with a red asterisk (\*) are required.

**Import from existing program** sits at the top of the step. Pick a program you administer to copy its details, technologies, skills and prerequisites into the form. The logo and the terms are not copied. The program name is copied too, so change it — you cannot continue while the name is already taken. Pick **None** to clear the form and start over.

| Field                                    | Required | Notes                                                                                    |
| ---------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| **Program Name**                         | Yes      | 3–100 characters. Must not already be taken                                              |
| **Linux Foundation Open Source Project** | Yes      | Picked from the project list                                                             |
| **Technologies**                         | Yes      | Add at least one with **Add Technology**. Up to 100 entries of up to 300 characters each |
| **Program Description**                  | Yes      | Rich text, up to 3,000 characters of plain text                                          |
| **Repository URL**                       | Yes      | Drives the repository statistics on the public program page                              |
| **Website URL**                          | No       | Shown as a link on the program page                                                      |

The rest of the step is in three sections:

| Section                                           | Field                   | Required | Notes                                                                                                                                                               |
| ------------------------------------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Infrastructure Initiative Best Practices** | **CII Project ID**      | No       | Your project's number on the CII Best Practices site. A valid ID shows the project's badge. You cannot continue while an entered ID is invalid or cannot be checked |
| **Code of Conduct**                               | **Code of Conduct URL** | No       | If you leave it empty, the listing defaults to the Contributor Covenant                                                                                             |
| **Program Design**                                | **Program Logo**        | Yes      | JPG or PNG, 420 × 420 px, max 2 MB. Select **Browse** to pick the file                                                                                              |

If your project has no CII Project ID yet, **Apply for CII** opens the CII Best Practices site.

## Step 2 — Program Setup

Define the skills mentees need and the term schedule.

| Field                                             | Notes                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| **Required and/or desirable skills and training** | Include non-technical areas your program could benefit from            |
| **Program Terms**                                 | Standard periods, or a custom term. A term name is up to 50 characters |
| **Open terms**                                    | At most **4** open terms at once                                       |

## Step 3 — Prerequisites

What candidates must complete to qualify. The table lists the standard prerequisites. Tick the **Required** box on each one candidates must complete — at least one prerequisite must be required.

**Coding Challenge** has an **Add URL:** field for the link to the challenge. The link is required when **Coding Challenge** is required.

Select **Add Custom Prerequisite** for anything unique to your program. A custom prerequisite is always required. It takes a **Prerequisite Name** of up to 20 characters, a **Due Date** that is today or later, and a **Prerequisite Description** of up to 500 characters, and can require a file submission. Select **Delete** to remove it.

Finally, review and accept the terms and conditions: the LFX Platform Use Agreement, the Service-Specific Use Terms, the Acceptable Use Policy and the Privacy Policy.

## Steps

1. Open [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin) and select **Enroll a Program**.
2. Complete **Program Details**, **Program Setup** and **Prerequisites**. The buttons at the bottom name the step they go to, for example **Next: Program Setup** and **Back: Program Details**.
3. Accept the terms and conditions.
4. Select **Submit**.

## After completing

You see **Program submitted for review.** The program sits at **Pending Review** until the LFX Mentorship team decides. Once approved it becomes **Open**, you invite mentors from the **Mentors** tab, and it starts taking applications.

## Troubleshooting

| What you see                                                     | What it means                                                                             |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| "Something on the form is not complete or invalid."              | Correct the highlighted fields before continuing.                                         |
| "This program name is taken."                                    | Another program uses that name. Choose a different one.                                   |
| "Invalid CII Project ID"                                         | Check the number, or clear the field. The CII Project ID is optional.                     |
| "Couldn't load that program. You can still enroll from scratch." | The import failed; the form is left as it was.                                            |
| "Program logo is not the right file type."                       | Use JPG or PNG. SVG is not accepted.                                                      |
| "Program logo must be 2 MB or smaller."                          | Shrink the image.                                                                         |
| "Program saved and sent for review, but the logo didn't upload." | The program exists; add the logo later with **Add logo** on its program card.             |
| "The program is saved, but its logo is missing. Leave anyway?"   | You are leaving a partially saved program. Add the logo from the program card afterwards. |
| "This text is too long or has too much formatting."              | Shorten the description or remove some links or styling.                                  |
| "You will lose your changes—are you sure you wish to cancel?"    | Leaving now discards unsaved answers.                                                     |

## Related

- [Approve or Reject a Program](../approve-a-program/) — the review step that follows
- [Manage Terms](../manage-terms/)
- [Manage a Program's Mentors](../manage-mentors/)
- [Your Programs (Program Admin)](../admin-programs/) — add a missing logo from the program card
