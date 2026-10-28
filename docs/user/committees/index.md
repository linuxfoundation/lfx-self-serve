---
title: Groups
description: Find your groups, join or leave them, and create and manage project groups (committees) in LFX Self Serve.
audience: [contributor, maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, groups, governance, membership, management]
last_updated: 2026-10-28
intercom_collection: Committees
---

This page applies to everyone who is signed in. Contributors, maintainers, board members, and executive directors can all find their groups and join or leave them where a group allows it. Creating a group takes write access to the selected foundation or project (executive directors always have it). Managing an existing group takes manager access to that group.

In LFX Self Serve, committees are called **Groups**: Technical Steering Committees (TSCs), boards, working groups, and other formal groups that govern a project. The Groups pages and these articles use "group"; the section is still filed under Committees in the help center.

## Groups

Groups is your personal membership inventory across foundations and projects. Contributor, Maintainer, Board Member, and Executive Director personas use the same inventory; it does not grant new management or voting permissions.

- Use category buttons, search, and the **Voting capability** filter to narrow your groups. Search includes group names, descriptions, and categories and settles after a short delay.
- **Foundation** and **Project** filters appear when your persona and available membership scopes support them. Selecting or removing a Foundation clears Project; removing Project keeps Foundation selected. Project choices are constrained to the selected Foundation.
- Active filters appear as removable chips. Long labels wrap within the panel while their remove buttons remain available. Remove one to keep the others, or use **Clear all**. **Reset filters** in either view clears all filters when there are no matches. Summary totals remain based on all your memberships, not the filtered results.
- Choose **List** or **Cards**. Your view choice is restored after reload. List rows stack on narrow screens; Cards reveal additional groups through **Show more**. Result-count updates remain available to screen readers, including the final reveal when the partial count is no longer visible. Filters are not newly preserved when returning from group details.
- Group names are primary, with your role and owning-project context nearby when available. **Public**/**Private** describes visibility. Public groups offer a separate copy-link control.
- Voting **Enabled** or **Disabled** describes the group's capability, not your eligibility to vote or the presence of an active ballot. **Unavailable** means capability data is missing or unusable.
- Mailing-list and chat controls open only real destinations, including HTTP(S) URLs with uppercase or mixed-case schemes. Chat identifiers such as `#general` appear as informational text rather than links; long identifiers wrap within Cards. **Mailing list associated** without an address is also informational. **No channels** means no chat value, mailing-list address, or mailing-list association was returned.

If your inventory is empty, there is no filter panel or reset action; invitations and pending applications can still appear. Existing loading errors are not distinguished from an empty inventory on this page.

## What you can do

- Find the groups you belong to, and any invitations or applications that are waiting ([Groups](#groups))
- Join an open group, apply to one, accept an invitation, or leave ([Join, Apply to, and Leave a Group](join-and-leave-a-group/))
- Create a group with the four-step wizard ([Create a Group](create-committee/))
- Edit a group, manage its members and import a CSV, and delete it ([Manage Groups](manage-committees/))
- Read a group's Overview and About tabs ([Group Overview and About](group-overview-and-about/))
- Change a group's join mode, visibility, mailing lists, chat channel, and features ([Group Settings](group-settings/))

## Navigation

Go to **app.lfx.dev** and select **Groups** from the left navigation. What you see depends on your lens (the Org lens also has a Groups page, at `/org/groups`, for groups your organization's employees take part in):

| Lens           | Route                | What it lists                                                                 |
| -------------- | -------------------- | ----------------------------------------------------------------------------- |
| **Me**         | `/groups`            | Your own memberships, with filters, plus pending invitations and applications |
| **Foundation** | `/foundation/groups` | Every group for the selected foundation                                       |
| **Project**    | `/project/groups`    | Every group for the selected project                                          |

**Create Group** appears at the top of the Foundation and Project lens pages for users who can create groups. It does not appear in the Me lens.

## Key concepts

- **Group**: A formal body with defined membership and a governance role within a project or foundation.
- **Group type**: The category you pick in the first step of the wizard, such as a TSC or a working group. You can change it later from the Settings tab.
- **Join mode**: How people get in. **Open** lets anyone join directly. **Invite Only** requires an invitation from a member or admin. **Apply & Review** lets people apply, and a manager approves or rejects. The group itself shows this mode as **Apply to Join**. **Closed** means only admins add members.
- **Visibility**: A group is **Public** or **Private**. A separate **Member Visibility** setting decides whether non-managers can see the roster (**Hidden** or **Basic Profile**).
- **Group page tabs**: Overview, About, Members, Votes, Meetings, Surveys, Documents, and Settings. Which of them you see depends on your access. See [Group Overview and About](group-overview-and-about/) and [Manage Groups](manage-committees/).
- **Membership badge**: The tag beside a group's name that says where you stand: Manager, Auditor, your member role, Application Pending, or Not a Member.

## Related sections

- [Votes](../votes/) — create and manage polls for group decisions
- [Meetings](../meetings/) — schedule and manage group meetings
- [Documents](../documents/) — manage documents associated with groups
