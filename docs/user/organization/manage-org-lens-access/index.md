---
title: Manage Org Lens Access
description: See who can open your organization in the Organization lens, and add people, change their role, or remove their access from the Org Lens Access tab.
audience: [all]
product_area: Organization
tags: [organization, org-lens, access, admin, viewer, invite, remove, people, company]
last_updated: 2026-11-06
intercom_collection: Organization
---

The **Org Lens Access** tab lists the people who have been granted Admin or Viewer access directly on your organization, plus anyone who has been invited and has not yet accepted. An Admin can add people, change their role, and remove their access there. Some people can open your organization in other ways, for example through access to a related organization. They are not listed on this tab, and you cannot change or remove their access here. Org Lens access is separate from committee or group membership: removing someone from a committee does not change their Org Lens access, and removing their Org Lens access does not change their committees.

These steps apply to Admins and Viewers of the organization. Only an Admin can make changes; a Viewer can see the list but not change it. A CLA Manager with no other role on the organization sees only **EasyCLA** and cannot open **People**.

## Roles

| Role                             | Shown as    | What they can do                                                                                                 |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| **Org Admin – Editor**           | **Admin**   | Full access to the organization's Org Lens, including adding, changing and removing other people's access.       |
| **Org Admin – Viewer**           | **Viewer**  | Read-only access. They can view all data and reports, but cannot make changes or manage access for other people. |
| Someone who has not yet accepted | **Invited** | Nothing yet. They appear as **Invited** next to their name until they accept the invite.                         |

An organization must always keep at least one Admin.

## Open the Org Lens Access tab

1. Sign in to [app.lfx.dev](https://app.lfx.dev) and switch to the **Organization** lens.
2. Select your organization.
3. In the sidebar, under **Organization Engagement**, select **People**.
4. Select the **Org Lens Access** tab.

The tab shows **Total Users**, **Administrators** and **Viewers**, then a table with each person's name and type. If no one has been granted access yet, the table says "No one has elevated Org Lens access for this organization yet."

To find someone, type in **Search by name, title, or email...**, or filter by type (**All types**, **Org Admin - Editor**, **Org Admin - Viewer** or **Invited**) or by **Employment**. Select **Clear filters** to reset them. Select a person's name to open their details.

## Add someone

You must be an Admin.

1. On the **Org Lens Access** tab, select **Add Users**.
2. Enter the person's **Email**. **Name** is optional.
3. Under **Access**, choose **Viewer** (the default) or **Admin**.
4. Select **Send Invite**.

The person is listed as **Invited** until they accept. You cannot change an invited person's role until they accept; you can remove the invite.

## Change someone's role

You must be an Admin.

1. Find the person in the table and select the edit icon (**Edit access**) in the **Actions** column.
2. In **Edit Org Lens Access**, choose **Admin** or **Viewer**.
3. Select **Save Changes**.

If the person is the organization's only Admin, you cannot change them to Viewer. The dialog says "This is the organization's only Admin. Promote another Admin before changing this role." Make someone else an Admin first.

## Remove someone's access

You must be an Admin.

1. Find the person in the table and select the trash icon (**Remove access**) in the **Actions** column.
2. Select **Remove** to confirm.

This removes the access granted to them on this tab. If they can also open the organization another way, for example through access to a related organization, they keep that access. Removing them does not remove them from any committee, group, mailing list or meeting, and it does not change their LFX account.

You cannot remove the organization's only Admin. Make someone else an Admin first, then remove them.

## Related

- [Who can see each lens](../../dashboards/#who-can-see-each-lens): how the Organization lens and its pages are shown
- [Organization FAQ](../faq/): short answers about Org Lens access and EasyCLA
