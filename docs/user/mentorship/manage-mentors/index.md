---
title: Manage a Program's Mentors
description: How a Program Admin invites mentors to an LFX Mentorship program and acts on mentor requests.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, mentors, invite, approve, decline, requests]
last_generated: 2026-10-26
last_updated: 2026-10-30
intercom_collection: Mentorship
---

The **Mentors** tab is where you bring mentors onto a program and act on the requests mentors raise themselves. It becomes available once the program is approved — mentors are not invited during enrollment.

## Before you begin

- You must be a Program Admin on the program.
- The program must be approved. You can invite mentors only while it is **Open** or **Completed**.

## Steps

1. Open [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin) and select the program.
2. Go to the **Mentors** tab.
3. Narrow the list with the **Search** box and the **Filter By Status** filter (**All statuses**, or one status).
4. To bring someone on, invite them:
   1. Type at least two characters into **Search and select mentors...**. Search by name, LF username, or full email address. Name search only finds people already in Mentorship; find anyone else by their exact LF username or full email address.
   2. Pick the person from the list. Each result shows their name and LF username.
   3. Select **Invite**.

   You see **Invitation sent.** They receive an email and answer it in LFX Self Serve. The invitation is sent straight away, with no confirmation step.

5. Use the row action. Which one a row offers depends on the mentor's status:

   | Status              | Row action                                             |
   | ------------------- | ------------------------------------------------------ |
   | Requested, Pending  | **Approve** or **Decline**                             |
   | Invited             | **Revoke invite** — the mentor can no longer accept it |
   | Approved            | **Remove** — they can request to join again later      |
   | Declined, Withdrawn | None                                                   |

   Each action asks you to confirm before it is applied.

The tab is paged ten mentors at a time.

On an **Open** or **Completed** program, a mentor's name links to their public mentor page when **Profile Created?** says **Yes**. The page opens in a new tab.

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

| What you see                                                                                                     | What it means                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| "We could not load the mentors. Try again."                                                                      | A transient failure reading the mentor list.                                                            |
| "No LF account found. Ask them to create one at sso.linuxfoundation.org, then invite them by email or username." | No account uses that email address. Once they create one, invite them again.                            |
| "No one matches that search."                                                                                    | Name search only finds people already in Mentorship. Try their exact LF username or full email address. |
| "Mentors can only be invited to a published program."                                                            | The program is not **Open** or **Completed**.                                                           |
| "This person is already on the program."                                                                         | They are already invited to, or a mentor of, the program.                                               |
| "This mentor changed. The list has been refreshed."                                                              | The mentor's status moved on before your action was saved. Check it before acting again.                |
| The mentor says their invitation link does not work                                                              | Invitation links are single use. Send a new invitation.                                                 |

## Related

- [Respond to a Mentor Invitation](../mentor-invitations/) — what the mentor sees
- [Review Applicants and Tasks](../mentor-program-detail/)
