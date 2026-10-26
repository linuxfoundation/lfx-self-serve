---
title: Manage a Program's Mentors
description: How a Program Admin invites mentors to an LFX Mentorship program and acts on mentor requests.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, mentors, invite, approve, decline, requests]
last_generated: 2026-10-26
last_updated: 2026-10-26
intercom_collection: Mentorship
---

The **Mentors** tab is where you bring mentors onto a program and act on the requests mentors raise themselves. It becomes available once the program is approved — mentors are not invited during enrollment.

## Before you begin

- You must be a Program Admin on the program.
- The program must be approved.

## Steps

1. Open [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin) and select the program.
2. Go to the **Mentors** tab.
3. To bring someone on, send an invitation. They receive an email and answer it in LFX.
4. Use the row action. Which one a row offers depends on the mentor's status:

   | Status              | Row action                                             |
   | ------------------- | ------------------------------------------------------ |
   | Requested, Pending  | **Approve** or **Decline**                             |
   | Invited             | **Revoke invite** — the mentor can no longer accept it |
   | Approved            | **Remove** — they can request to join again later      |
   | Declined, Withdrawn | None                                                   |

   Each action asks you to confirm before it is applied.

The tab is paged ten mentors at a time.

## Mentor status

| Status        | What it means                                 |
| ------------- | --------------------------------------------- |
| **Requested** | The mentor asked to join                      |
| **Invited**   | You invited them; they have not answered      |
| **Pending**   | Awaiting a decision                           |
| **Approved**  | They mentor the program                       |
| **Declined**  | Not approved, or they declined the invitation |
| **Withdrawn** | The request or invitation was pulled          |

## Troubleshooting

| What you see                                        | What it means                                           |
| --------------------------------------------------- | ------------------------------------------------------- |
| "We could not load the mentors. Try again."         | A transient failure reading the mentor list.            |
| The mentor says their invitation link does not work | Invitation links are single use. Send a new invitation. |

## Related

- [Respond to a Mentor Invitation](../mentor-invitations/) — what the mentor sees
- [Review Applicants and Tasks](../mentor-program-detail/)
