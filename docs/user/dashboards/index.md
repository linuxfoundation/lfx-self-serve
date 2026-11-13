---
title: Dashboard
description: The LFX Self Serve dashboard provides a lens-based overview of your personal activity, your projects and foundations, and your company's involvement.
audience: [all]
product_area: Dashboards
tags: [dashboard, overview, lens, access, me, foundation, project, org, company, company, employer]
last_updated: 2026-11-06
intercom_collection: Dashboards
---

The Dashboard is the central starting point of LFX Self Serve. It adapts to show you relevant information based on your roles on Linux Foundation projects and what you are viewing (your lens).

## Lens system

The LFX dashboard uses a **lens** concept to let you switch between different viewing perspectives:

| Lens           | Description                                            |
| -------------- | ------------------------------------------------------ |
| **Me**         | Your personal activity, contributions, and involvement |
| **Foundation** | Foundation-level governance, projects, and analytics   |
| **Projects**   | A specific project's metrics, committees, and activity |
| **Company**    | Your company's membership and participation            |

Not all users see all lenses.

## Who can see each lens

Which lenses you see depends on your roles on Linux Foundation projects, such as committee seats, maintainer roles, and admin access.

| Lens           | Who sees it                                                                                                                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Me**         | Everyone.                                                                                                                                                                                                                                                                                                              |
| **Projects**   | Almost everyone who is signed in: anyone with a project role, such as committee member or maintainer, and project admins. Users whose only roles are foundation-level, such as a board seat, executive director or Linux Foundation staff, do not see it unless they also have a project role or project admin access. |
| **Foundation** | Board members and executive directors of a foundation, foundation admins, Linux Foundation staff, and a few other Linux Foundation admin, auditor and marketing roles.                                                                                                                                                 |
| **Company**    | Everyone sees the lens. The pages for a specific company show only if you have access to that company. See [Who can access this](#who-can-access-this) under Your company's activity.                                                                                                                                  |

If you can use both the Foundation and Projects lenses, the sidebar shows a single **Projects** tab instead of two separate tabs. It lists both foundations and projects; select a foundation to open the Foundation lens.

Some pages inside a lens have their own access rules. For example, **Health Metrics** in the Foundation lens is available only to the foundation's executive director and to Linux Foundation staff.

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

The **Company Overview** is the **Dashboard** of the Company lens: a one-page summary of how the selected company takes part in Linux Foundation foundations and projects, instead of your personal activity. Its address is `/company/<company>/overview`. See [Company Overview dashboard](../company/company-overview/) for what each card and tile shows.

### Company scope

Pages in Company Lens that count contributors — **People** (Contributors and All Employees), **Code Contributions**, the **Projects** list and a project's detail page — have an **Company scope** dropdown. It sits under **More filters** at the end of the filter row, with the other less-used filters each page has: the code count (such as **All code contributions**), **Employment** and **Team members**. **More filters** shows how many of them are set to something other than their default, for example **More filters (2)**, and **Clear filters** resets them too. Search, foundation, time range and LF / non-LF projects stay in the main row. The dropdown offers:

- **Insights company** (the default) counts only the company shown on your company's LFX Insights page, and only in the repositories LFX Insights counts, so the numbers line up with that page.
- **All related companies (N)** counts every company linked to your company account — subsidiaries, acquisitions and duplicate records — in every repository. N is how many of those companies have code activity in the past two years.

Your choice stays in the page address (`?orgScope=all`) and carries to the other pages with the dropdown when you move between them from the sidebar, the Projects list or a project's detail page. The Company Overview has no dropdown: its **Active Contributors** card always counts the Insights company (every related company if your company has no LFX Insights company with code activity in the past two years), and links from the Overview open the other pages with the Insights company selected. Maintainer roles, board and committee seats, events and training are counted the same way under both options. On **All Employees** the choice changes code contributions, so someone whose only activity is code outside the Insights company is listed only under **All related companies**. All Employees counts code from the same data as **People → Contributors**, so with the employment filter set to **All employees** its **Code Contributors** card shows the same number as Contributors for the same time range, project type, company scope and team-member choice. If your company has no LFX Insights company with code activity in the past two years, the dropdown is disabled and every related company is counted.

On the **Projects** list the choice changes the **Contributors** column only; influence, health, participants and maintainers are the same under both options. On a project's detail page, contributors' first and most recent activity dates come from every related company. Under **Insights company**, the influence level next to **Our Technical Influence** and **Our Ecosystem Influence** is the Insights company's own; if it has no leaderboard ranking on the project, no level is shown, even when a related company has one.

**People**, **Code Contributions** and the **Projects** list also have a **Team members** dropdown under **More filters**. People marked as team members in LFX are excluded by default, as LFX Insights does; choose **Include team members** to count them. Your choice stays in the page address (`?teamMembers=include`) and carries between these pages when you move between them from the sidebar. On the **Projects** list it changes the **Contributors** column only; participants and maintainers are the same under both options.

### Navigation

On a larger screen, selecting **Company** in the lens switcher opens the Company Overview of the selected company. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Dashboard** in it to open the page. If your only role on that company is CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager), you land on its **EasyCLA** page instead.

### Who can access this

Everyone can open the **Company** lens, but a company's pages show only to people who have access to that company, directly or through a related company. A CLA Manager or initial CLA Manager designee with no other role on a company sees only its **EasyCLA** page. Admin and viewer access is granted by the company's own **Company Lens administrators**, not by the Linux Foundation. Administrators manage it on the **Company Lens Access** tab; see [Manage Company Lens Access](../company/manage-company-lens-access/). If you are not sure who they are, your company's open source program office (OSPO) is a good place to start. Linux Foundation staff can open every company.

If you do not have access, the Company lens shows a message instead of your company's pages, such as:

- **No company linked to your account**: LFX did not find a company you have access to, and could not confirm that your employer is a Linux Foundation member. You can see this even if you have already added an affiliation. The message offers **Add an affiliation**, which links your profile to your employer, but an affiliation does not by itself give you access. You still need a grant from your company's Company Lens administrators.
- **You do not have access to the Company Lens**: your employer is a Linux Foundation member, but you have not been granted access to it.
- **You do not have access to this company**: the link you opened is for a company you do not have access to.

For the other messages, such as **Some companies could not be loaded**, see [What do the messages on the Company Overview mean?](../company/company-overview/#what-do-the-messages-on-the-company-overview-mean).

If you are a CLA Manager or an initial CLA Manager designee, see [Why can't I see my company in the Company lens?](../company/faq/#why-can-t-i-see-my-company-in-the-company-lens).

## Related sections

- [Company involvement in a foundation](./company-involvement/) — one company's membership tier, contributors, maintainers, events and training in the foundation you are viewing
- [Committees](../committees/) — manage your project governance groups
- [Meetings](../meetings/) — view upcoming and past meetings
- [Votes](../votes/) — participate in and manage polls
