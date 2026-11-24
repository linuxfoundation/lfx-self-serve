---
title: Permissions
description: See who has access to a project or foundation in LFX Self Serve, what each permission role allows, and how to get access.
audience: [all]
product_area: Permissions
tags: [permissions, access, manage, view, meeting-coordinator, maintainer, contributor, roles]
last_updated: 2026-11-12
intercom_collection: Permissions
---

The **Permissions** page lists the people who have been granted access to a project or foundation, and the role each one holds. It is where project-wide access is granted in LFX Self Serve. Group managers can also manage their own group's members and meetings; see [Manage groups](../committees/manage-committees/).

## Role labels are not permissions

You may see a **Maintainer** or **Contributor** label next to a project in LFX Self Serve, for example on the **Project Involvement** cards on the [Work history & Affiliations](../account/work-history/) tab, or in the context picker in the top navigation. These labels describe your involvement with the project. They do not grant any access:

- A **Contributor** label does not stop you from viewing a project.
- A **Maintainer** label does not let you manage a project.

Project-wide access is set by your role on the project's **Permissions** page. To get more access, see [How to get access to a project](#how-to-get-access-to-a-project).

## Open the Permissions page

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Switch to the **Projects** or **Foundation** lens and select the project or foundation.
3. In the left navigation, under **Governance**, select **Permissions** (`/project/settings` for a project, `/foundation/settings` for a foundation).

The list shows each person with access and their **Role**, and can be filtered by role.

If you don't have **Manage** access, the page is read-only and shows: _You have view-only access to this project's settings. Contact a project manager to make changes._

## Permission roles

Each role applies across the whole project. View and Manage cover all project content, including committees, meetings, and mailing lists; Meeting Coordinator covers the project's meetings.

| Role                    | What it allows                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| **View**                | Read-only access to view and browse all project content.                                                   |
| **Manage**              | Full access to create, edit, delete, and manage all project content, including this Permissions page.      |
| **Meeting Coordinator** | Create, update, and delete meetings and past meetings, including registrants, attachments, and recordings. |

## How to get access to a project

There is no request-access button in LFX Self Serve. To get access, or a different role, contact a project manager: someone with **Manage** access on the project. They can add you on the Permissions page. If you don't know who that is, contact support and include the project name and the role you need.

## Add, change, or remove a user (Manage only)

These options appear only if you have **Manage** access.

### Add a user

1. On the Permissions page, under **Quick Actions**, select **Add User**.
2. Enter the person's **Email**. LFX looks the email up in the directory.
3. Choose a **Role**: **View**, **Manage**, or **Meeting Coordinator**.
4. Select **Add User**.

The person is added straight away; there is no invitation for them to accept.

If no account matches the email, a **User Not Found** dialog asks whether to add them anyway. Select **Yes, Continue**, enter their **Full Name** (and optionally an avatar URL), then select **Add User**.

If the person is already on the project, **Add User** does not change their role. A message tells you so: "This person is already on the project. To change their role, use the Actions (⋮) menu on their row and choose Edit." Change their role as described in the next section.

### Change a user's role

1. Open the actions menu on the person's row and select **Edit**.
2. Choose a new **Role** and select **Update User**.

### Remove a user

1. Open the actions menu on the person's row and select **Remove**.
2. Confirm with **Remove**. This removes the role assigned to them on this page. Access they have from elsewhere, such as a group they manage, is not removed here.

## Related

- [Work history & Affiliations](../account/work-history/): where the Maintainer and Contributor labels on your projects come from
- [Navigate dashboards](../dashboards/navigate-dashboards/): switch lenses and select a project
- [Meetings](../meetings/): what Meeting Coordinator access lets you do
