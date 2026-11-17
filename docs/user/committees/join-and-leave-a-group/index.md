---
title: Join, Apply to, and Leave a Group
description: How to find a project's groups, join an open group, apply to join, accept or decline an invitation, and leave a group in LFX Self Serve.
audience: [contributor, maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, groups, join, apply, invitation, leave, membership, find, browse, public, calendar]
last_updated: 2026-11-05
intercom_collection: Committees
---

How you become a member of a group depends on the group's **join mode**. This article covers what you see on the group's page for each mode, how to respond to an invitation, and how to leave. Managers choose the join mode in [Group Settings](../group-settings/).

## Find a group to join

You don't need a role on a project to see its groups. Any signed-in user can open a project and browse its groups.

1. Sign in to [app.lfx.dev](https://app.lfx.dev) and open the **Projects** tab in the sidebar.
2. Search for the project and select it.
3. Select **Groups** in the sidebar. The page lists the project's groups.
4. Select a group to open its page. The button in the header depends on the group's join mode, described below.

You see the project's **public** groups, plus any **private** groups you are a member of or manage. Private groups you don't have access to are not listed. If you open a link to one, the page says "We couldn't load this group", without confirming whether the group exists. To join a private group, you need an invitation, or a group manager has to add you.

If you don't see a **Projects** tab, or you want to browse without signing in, open the project's public groups list at `app.lfx.dev/projects/<project-slug>/groups`. It lists the project's public groups; select one to open its page, then sign in to join. If someone shared a link to a group, you can open it directly.

After you join, the group appears under **Groups** in the **Me** lens. Pending invitations and applications are listed there too, until you accept or an admin approves you.

### See a project's meetings without joining

In the **Projects** tab, select the project, open **Meetings**, and select **Public Calendar**. It opens the project's public calendar, which anyone can view without signing in. Meetings that aren't public don't appear on it. On a group's page, the **Meetings** tab shows to people who aren't members only when the group's calendar is public.

## Join modes

| Join mode          | What it means                                 | What you can do                           |
| ------------------ | --------------------------------------------- | ----------------------------------------- |
| **Open**           | Anyone can join this group directly           | Select **Join Group**                     |
| **Apply & Review** | You can apply; an admin reviews your request  | Select **Apply to Join**                  |
| **Invite Only**    | You need an invitation from a member or admin | Accept an invitation when you receive one |
| **Closed**         | Only admins can add members                   | Select **Contact Admin**                  |

Managers pick **Apply & Review** in Settings, and the group itself shows that mode as **Apply to Join**. The header of a group you aren't in shows only the button that fits its join mode. Invite Only groups show no join button.

## Join an open group

1. Open the group from **Groups**, or from a link someone shared. See [Find a group to join](#find-a-group-to-join).
2. Select **Join Group**.
3. If the group has voting or requires a business email, a **Confirm Company** dialog asks for your company name and website. It starts with your current employer from your profile when LFX can find one. Confirm or correct it.
4. A "Joined" message confirms, and the page refreshes with your membership badge.

If joining fails, an "Unable to Join" message explains why.

## Apply to join

1. Open the group and select **Apply to Join**.
2. If the group asks for a company, confirm it in the **Confirm Company** dialog.
3. In the **Request to Join** dialog, optionally write a message introducing yourself (up to 2,000 characters), then select **Submit Application**.
4. A confirmation says an admin will review your request. Your badge changes to **Application Pending**, and **Apply to Join** is no longer offered.

If you apply to a group you already applied to, you get a message that you already have a pending application. See [Manage Groups](../manage-committees/#pending-applications) for the manager side.

## Closed groups

In a **Closed** group, **Contact Admin** shows a reminder to ask a group admin for membership. It doesn't send a message for you, so reach the admin through the group's chair or your project contacts.

## Accept or decline an invitation

When you're invited to a group, a banner at the top of the group's page says "You've been invited to _group name_", with who invited you and when the invitation expires when that's known. The invitation also appears with your pending actions on your dashboard.

- **Accept** adds you to the group. If the group needs a company, you confirm it first.
- **Decline** hides the invitation and shows an "Invitation declined" message with **Undo**. You have about five seconds to select **Undo** before the decline is sent. After that, ask the group's manager to invite you again.

If you open an invited group's link before accepting, you may see an access message with **Accept Invitation** and **Decline** buttons in place of the group.

## Leave a group

1. Open the group.
2. Select **Leave Group** in the header.
3. A "Left" message confirms.

**Leave Group** takes effect immediately and doesn't ask you to confirm. If it fails, an "Unable to Leave" message explains why; contact the group's manager.

## Membership badges

The tag next to the group's name shows where you stand:

| Badge                   | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| **Manager**             | You can edit the group, manage members, and change settings              |
| **Auditor**             | You can review the group's activity and settings, but not change them    |
| Your member role        | You're a member. A member with no specific role shows **Member**         |
| **Application Pending** | Your request to join is under review; you'll be notified of the decision |
| **Not a Member**        | You can see the group but aren't in it                                   |

Hover over a badge for a short explanation of what it allows.

## Who sees what

- **Members and managers** see the Votes, Meetings, and Surveys tabs, subject to the group's settings. Votes appears only when the group has voting enabled.
- **Visitors** see the Overview, About, and Documents tabs. They also see Meetings when the group's calendar is public.
- Whether people other than managers and auditors can see the member list depends on the group's **Member Visibility**: **Hidden** keeps it private, and **Basic Profile** shows it. In an Invite Only group, members who can send invites also see the **Members** tab so they can use **Invite Someone**.
- Settings is shown only to managers and auditors.

## Related

- [Group Settings](../group-settings/) — how managers choose the join mode
- [Manage Groups](../manage-committees/) — approving applications and revoking invitations
- [Groups FAQ](../faq/)
