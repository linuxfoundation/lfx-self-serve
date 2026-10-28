---
title: Group Settings
description: How managers change a group's name, type, join mode, visibility, mailing lists, chat channel, and features, and how to delete a group.
audience: [maintainer, board-member, executive-director]
product_area: Committees
tags: [committees, groups, settings, join-mode, mailing-lists, delete]
last_updated: 2026-10-28
intercom_collection: Committees
---

The **Settings** tab on a group's page is where managers adjust how the group works after it's created. Managers can change everything below. Auditors can open the tab to view it but can't save changes. Other people don't see it.

## Open the Settings tab

1. Open the group from **Groups**.
2. Select the **Settings** tab.
3. Change what you need and select **Save Changes**. The button appears at the top and bottom of the tab and stays unavailable while the form has errors.

A "Settings saved" message confirms the update.

## General

- **Group Name** (required)
- **Group Type**: changing it asks you to confirm in a **Change Group Type** dialog, because it updates how the group is labeled and governed, including on its members' records.
- **Parent Group** (optional): makes this group a sub-group of another one.

## Member visibility

**Member Profile Visibility** controls what non-managers can see of the member list.

- **Hidden**: the roster is private.
- **Basic Profile**: the roster is visible, and the Members tab appears for visitors.

## Join mode

**How Can People Join the Group?** sets who can get in.

- **Open — anyone can join**: people select **Join Group**.
- **Invite Only — members send invites**: members who aren't managers can see **Invite Someone** on the Members tab.
- **Apply & Review**: people apply, and managers approve or reject on the Members tab.
- **Closed — admin adds members**: only admins add people.

See [Join, Apply to, and Leave a Group](../join-and-leave-a-group/) for what people see in each mode.

## Connected channels

### Associated mailing lists

Members are automatically subscribed to a group's associated mailing lists when they join.

1. Under **Associated Mailing Lists**, select **+ Add List**.
2. In the **Associated Mailing Lists** dialog, search for the lists to link, and select **Save**.
3. To unlink a list, select the **x** beside it.

Each list shows its name, **Public** or **Private**, type, address, and subscriber count. Mailing list changes save as soon as you confirm them; you don't need **Save Changes**. A note on the card explains that removing someone from the group also removes them from the mailing list when the list is private.

Mailing lists are added from this tab after the group exists; the create wizard doesn't include them.

### Chat channel and repository

- **Chat Channel**: a Slack, Discord, or other chat URL. The platform is detected from the URL.
- **Repository / Website**: the group's GitHub, GitLab, or other website URL.

These links appear on the group's page and About tab.

## Group features

Toggle each feature, then **Save Changes**:

- **Business Email Required**: members must have a business email address.
- **Enable Voting**: lets members vote on group matters. The **Votes** tab appears when this is on.
- **Enable Audit**: tracks and logs group activity for compliance.
- **Make Group Public**: makes the group visible to all users.
- **Enable SSO Group**: syncs membership with a Single Sign-On provider.
- **Show Meeting Attendees**: lets guests see who else is invited to the group's meetings. Board and restricted meetings never share their guest list.

With **Business Email Required** or **Enable Voting** on, members who join must give an organization name and website.

## Delete a group

The **Danger Zone** at the bottom of the tab holds **Delete Group**.

1. Select **Delete Group**.
2. Read the **Delete Group** dialog, which names the group, and select **Delete**.

Deletion permanently removes the group and its meetings, votes, surveys, and member records, and can't be undone. A "Deleted" message confirms it. If deletion fails, you see "Failed to delete group" and nothing is removed.

## Related

- [Create a Group](../create-committee/) — the same options at creation time
- [Manage Groups](../manage-committees/) — edit the group, manage members and applications
- [Group Overview and About](../group-overview-and-about/)
