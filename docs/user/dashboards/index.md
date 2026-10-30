---
title: Dashboard
description: The LFX Self Serve dashboard provides a lens-based overview of your projects, foundation, and personal activity.
audience: [all]
product_area: Dashboards
tags: [dashboard, overview, lens, persona, me, foundation, project, org]
last_updated: 2026-10-29
intercom_collection: Dashboards
---

The Dashboard is the central starting point of LFX Self Serve. It adapts to show you relevant information based on who you are (your persona) and what you are viewing (your lens).

## Lens system

The LFX dashboard uses a **lens** concept to let you switch between different viewing perspectives:

| Lens           | Description                                            |
| -------------- | ------------------------------------------------------ |
| **Me**         | Your personal activity, contributions, and involvement |
| **Foundation** | Foundation-level governance, projects, and analytics   |
| **Project**    | A specific project's metrics, committees, and activity |
| **Org**        | Your organization's membership and participation       |

The lenses available to you depend on your persona. Not all users see all lenses.

## Persona system

Your **persona** is determined by your committee memberships and roles across Linux Foundation projects. The four personas are:

| Persona                | Access                                                                        |
| ---------------------- | ----------------------------------------------------------------------------- |
| **Contributor**        | Me and Project lenses                                                         |
| **Maintainer**         | Me and Project lenses with write access                                       |
| **Board Member**       | Me, Foundation, and Project lenses                                            |
| **Executive Director** | Me, Foundation, and Project lenses (Org lens available with org admin access) |

## Your personal dashboard

The **Me lens** (route: `/`) is your personal dashboard. It shows your individual contributions, badges, upcoming events, and activity across Linux Foundation projects. This is the default view when you log in.

### What you see

- Your personal contributions and open-source activity
- Badges and credentials you have earned
- Upcoming events relevant to your project affiliations
- A summary of your committee memberships and roles

### Navigation

Go to **app.lfx.dev** — the Me lens is the default view on login, or select **Me** from the lens selector at the top of the page.

## Your company's activity

The **Org Overview** page in Org Lens (route: `/org`) shows your organization's membership and participation across Linux Foundation projects. Instead of your personal activity, this view surfaces how your company is engaged with the Linux Foundation as a whole.

### What you can see

- Your organization's current membership status and tier
- Committee participation by members of your organization
- Contribution and engagement metrics across projects your company supports
- Key contacts and representatives for your organization

### Organization scope

Pages in Org Lens that count contributors — the Org Overview's **Active Contributors** card, **People** (Contributors and All Employees), **Code Contributions** and a project's detail page — have an **Organization scope** dropdown:

- **Insights organization** (the default) counts only the organization shown on your company's LFX Insights page, and only in the repositories LFX Insights counts, so the numbers line up with that page.
- **All related organizations (N)** counts every organization linked to your company account — subsidiaries, acquisitions and duplicate records — in every repository. N is how many of those organizations have code activity in the past two years.

Your choice stays in the page address (`?orgScope=all`) and carries to the other Org Lens pages when you move between them from the sidebar, the Projects list or a project's detail page. Maintainer roles, board and committee seats, events and training are counted the same way under both options. On **All Employees** the choice changes code contributions, so someone whose only activity is code outside the Insights organization is listed only under **All related organizations**. If your company has no LFX Insights organization with code activity in the past two years, the dropdown is disabled and every related organization is counted.

### Navigation

Switch to the **Org** lens using the lens selector at the top of LFX Self Serve. The Org Overview is the default landing page for the Org lens (route: `/org`).

### Who can access this

Accessing the Org Overview requires **admin access** to your organization in LFX. If you are not yet an admin, another admin at your organization can invite you to accept an admin role. Once you accept, the Org lens will become available to you and you will be able to view your company's collective activity.

## Related sections

- [Committees](../committees/) — manage your project governance groups
- [Meetings](../meetings/) — view upcoming and past meetings
- [Votes](../votes/) — participate in and manage polls
