---
title: Create a Group
description: How to create a group (committee) in LFX Self Serve with the four-step wizard, including type, join mode, voting, and members.
audience: [maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, groups, create, wizard, join-mode, governance]
last_updated: 2026-10-28
intercom_collection: Committees
---

This article applies to users with **maintainer**, **board-member**, or **executive-director** roles. You create a group with a four-step wizard: **Group Type**, **Basic Information**, **Settings**, and **Add Members**.

## Before you begin

Switch to the **Foundation** or **Project** lens that should own the group. **Create Group** is offered at the top of the Groups page in those lenses only; it is not shown in the **Me** lens. If you don't see the button, your current role can't create groups in that context.

## Steps

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to your **Foundation** or **Project** lens.
3. Select **Groups** in the left navigation, then **Create Group**.
4. Work through the steps below. The header shows "Step _N_ of 4". Select **Next** to move forward and **Previous** to go back. **Next** stays unavailable until the current step's required fields are complete.

### Step 1: Group Type

Choose the type that best describes the group, such as Technical Steering Committee, Working Group, Special Interest Group, Board, Maintainers, or Other. The type organizes and identifies the group within the project. You can change it later in [Group Settings](../group-settings/). The step bar labels this step **Category**.

### Step 2: Basic Information

- **Group Name** (required)
- **Parent Group** (optional): pick another group to make this one a sub-group. Leave it empty for a top-level group.
- **Description**
- **Group Website**: a full URL such as `https://example.com`

### Step 3: Settings

- **Member Profile Visibility**: **Hidden** or **Basic Profile**. This controls whether people who aren't managers or auditors can see the member list.
- **How Can People Join the Group?** (join mode): **Open — anyone can join**, **Invite Only — members send invites**, **Apply & Review**, or **Closed — admin adds members**.
- **Connected Channels**: a **Chat Channel** link (Slack, Discord, or another chat URL) and a **Repository / Website** link. The platform is detected from the URL. Associated mailing lists are added after the group exists, from the group's **Settings** tab.
- **Group Features**, each a toggle:
  - **Business Email Required**: members must have a business email address.
  - **Enable Voting** (recommended): lets members vote on group matters.
  - **Enable Audit**: tracks and logs group activity for compliance.
  - **Make Group Public** (recommended): makes the group visible to all users.
  - **Enable SSO Group**: syncs membership with a Single Sign-On provider.
  - **Show Meeting Attendees**: lets guests see who else is invited to the group's meetings. Board and restricted meetings never share their guest list.

  With **Business Email Required** or **Enable Voting** on, members joining the group must give an organization name and URL.

Select **Create Group**. The group is saved at this point, before you add members.

### Step 4: Add Members

Add the first members, or skip this step. You can invite by email, add people with details, or import a CSV. See [Import members from a CSV](../manage-committees/#import-members-from-a-csv). Nothing you stage here is saved until you select **Done**.

- **Done** saves the staged members and takes you back to the Groups page.
- **Skip For Now** leaves without adding anyone. The group already exists, and you can add members later.

If some members fail to save, you stay on the step so you can retry rather than lose them.

## After creation

The group appears on the Groups page for its foundation or project. Open it to see its tabs. Use **Edit Group** to rerun the wizard on an existing group. See [Manage Groups](../manage-committees/).

## Permissions

Only users with maintainer, board-member, or executive-director personas can create groups. The create page itself is also protected: if you open it without write access, you can't use it.

## Related

- [Manage Groups](../manage-committees/) — edit, add members, and delete
- [Group Settings](../group-settings/) — change join mode, visibility, mailing lists, and features later
- [Join, Apply to, and Leave a Group](../join-and-leave-a-group/) — what people see for each join mode
- [Votes](../../votes/) — set up votes for a voting group
