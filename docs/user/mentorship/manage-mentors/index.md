---
title: Manage a Program's Mentors
description: How a Program Admin invites mentors to an LFX Mentorship program and acts on mentor requests.
audience: [all]
product_area: Mentorship
tags: [mentorship, program-admin, mentors, invite, approve, decline, requests]
last_generated: 2026-10-26
last_updated: 2026-11-17
intercom_collection: Mentorship
---

The **Mentors** tab is where you bring mentors onto a program and act on the requests mentors raise themselves. It becomes available once the program is approved — mentors are not invited during enrollment.

## Before you begin

- You must be a Program Admin on the program.
- The program must be approved. You can invite mentors only while it is **Accepting**, **In Progress**, **Upcoming** or **Completed**.

## Steps

1. Open [app.lfx.dev/mentorship/admin](https://app.lfx.dev/mentorship/admin) and select the program.
2. Go to the **Mentors** tab.
3. Narrow the list with the **Search** box and the **Filter By Status** filter (**All statuses**, or one status).
4. To bring someone on, select **Invite mentor**. The **Invite a mentor** dialog opens.
   1. Type at least two characters into **Name, LFID or email**. Search by name, LF username, or full email address. Name search only finds people already in Mentorship; find anyone else by their exact LF username or full email address.
   2. Select the person in the list. Each result shows their name and LF username.
   3. Select **Send invite**, or press **Enter**.

   You see **Invitation sent.** They receive an email and answer it in LFX Self Serve.

   If they don't have an LF account yet, type their full email address instead. When no account uses it, the dialog says **No LF account uses this email** and shows **Invite** with that address, followed by what they'll need to do: create an LF account with this email, set up a mentor profile, then accept the invitation. Select **Send email invite**, or press **Enter**. You see **Invitation sent. They need to create an LF account with this email address to accept it.** Their row shows the email address with **Awaiting LF account** until they accept. Only an LF account that uses that address can accept the invitation.

   Select **Cancel** to close the dialog without inviting anyone. If an invite can't be sent, the dialog stays open so you can try again.

5. Use the row action. Which one a row offers depends on the mentor's status:

   | Status              | Row action                                             |
   | ------------------- | ------------------------------------------------------ |
   | Requested, Pending  | **Approve** or **Decline**                             |
   | Invited             | **Revoke invite** — the mentor can no longer accept it |
   | Approved            | **Remove** — they can request to join again later      |
   | Declined, Withdrawn | None                                                   |

   Each action asks you to confirm before it is applied.

The tab is paged ten mentors at a time.

On an approved program (**Accepting**, **In Progress**, **Upcoming** or **Completed**), a mentor's name links to their public mentor page when **Profile Created?** says **Yes**. The page opens in a new tab.

## Mentor status

| Status        | What it means                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Requested** | The mentor asked to join                                                                                                       |
| **Invited**   | You invited them; they have not answered. Under an email invitation, **Awaiting LF account** means they have no LF account yet |
| **Pending**   | Awaiting a decision                                                                                                            |
| **Approved**  | They mentor the program                                                                                                        |
| **Declined**  | Not approved, or they declined the invitation                                                                                  |
| **Withdrawn** | The request or invitation was pulled                                                                                           |

## Troubleshooting

| What you see                                                                                                     | What it means                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "We could not load the mentors. Try again."                                                                      | A transient failure reading the mentor list.                                                                                        |
| "No LF account found. Ask them to create one at sso.linuxfoundation.org, then invite them by email or username." | No LF account has that username. Check it, or invite them by their full email address.                                              |
| "No LF account uses this email"                                                                                  | No account uses that email address. Select **Send email invite** to invite them anyway; they create an LF account when they accept. |
| "This person's LF email address is already used by another Mentorship account, so they can't be invited."        | Their LF account's primary email address is already on a different Mentorship account, so the invitation can't be linked to them.   |
| "No one matches that search."                                                                                    | Name search only finds people already in Mentorship. Try their exact LF username or full email address.                             |
| "Mentors can only be invited to a published program."                                                            | The program is not approved: it is not **Accepting**, **In Progress**, **Upcoming** or **Completed**.                               |
| "This person is already on the program."                                                                         | They are already invited to, or a mentor of, the program.                                                                           |
| "This mentor changed. The list has been refreshed."                                                              | The mentor's status moved on before your action was saved. Check it before acting again.                                            |
| The mentor says their invitation link does not work                                                              | The invitation was already answered or revoked. Invite them again: inviting the same person or email address resends the email.     |
| The mentor says the invitation is "for a different account"                                                      | For an email invitation, they signed in with an LF account that doesn't use the invited address. They need the account that does.   |

## Related

- [Respond to a Mentor Invitation](../mentor-invitations/) — what the mentor sees
- [Review Applicants and Tasks](../mentor-program-detail/)
