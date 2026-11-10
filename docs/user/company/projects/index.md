---
title: Projects and project detail
description: How to read the Projects table for the selected company, filter and export it, manage shared workspaces, and open a project's detail page to see the company's influence, its leaderboard standing, how each company's leaderboard score breaks down, and the influence trend.
audience: [all]
product_area: Company
tags: [company, org, org-lens, projects, project-detail, workspaces, influence, leaderboard, score-breakdown, health, contributors, participants]
last_updated: 2026-11-06
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). Adding projects and managing workspaces also needs edit access to the company, which its Admins have. A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **Projects**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

## What is the Projects page?

The Projects page lists the open source projects in one of the selected company's workspaces, with each project's health, the company's influence on it, and how many of its people contribute and participate. Most are projects the company is involved in. Someone who can edit the company, such as an Admin, can also add projects it has no activity in yet. Its address is `/company/<company>/projects`.

The page heading is **Projects —** followed by the company's name. The line under it is **The open source projects your company influences, contributes to, and depends on.** The sidebar item that opens it is **Projects**.

The table shows one workspace at a time. A workspace is a saved list of projects that everyone at the company shares. The first one is **All Projects with Activities**.

## How do I open Projects?

You open **Projects** from the Company lens sidebar once a company is selected. A CLA Manager or initial CLA Manager designee with no other role on that company is sent to **EasyCLA** instead.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. Select **Projects** in the sidebar. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Projects** in it.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, Projects is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-a-company).

## What does each column in the Projects table show?

Each row of the Projects table shows one project's health, the company's technical and ecosystem influence on it, its influence trend over the past year, and how many of the company's employees contribute and participate. Select a project name to open its detail page. Hover a column heading to read what it measures.

| Column                   | What it shows                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project**              | The project logo and name. The name opens the project's detail page                                                                                                                                                                              |
| **Health**               | The project's LFX Insights health label: **Excellent**, **Healthy**, **Fair**, **Concerning**, **Critical**, or **Unavailable**                                                                                                                  |
| **Technical influence**  | The company's influence on the project's code activity (commits and pull requests), as a band: **Leading**, **Contributing**, **Participating**, or **Silent**                                                                                   |
| **Ecosystem influence**  | The company's influence on the project's non-code collaboration (documentation, committees, meetings, events), as the same bands. A project outside the Linux Foundation (LF) shows **Non-LF Project**                                           |
| **Influence Trend (1y)** | A line showing how the company's combined influence changed over the rolling 12 months, and the change as a percentage                                                                                                                           |
| **Contributors**         | How many of the company's employees contributed code to the project in the past 2 years, counted under the chosen **Company scope** and **Team members** choices. The number opens the project's detail page with its **Contributors** card open |
| **Participants**         | How many of the company's employees were involved in the project in any way in the past 2 years, including code contributions, documentation collaboration, events, and training. The number opens the project's detail page                     |

The hover text on both influence columns says **Technical influence examines code activities (commits, PRs) while ecosystem influence examines non-code collaboration activities (documentation, committees, meetings, events).** and **Comparing our company's share of these activities to the project total indicates greater influence in the project.** Each band also shows signal bars: four filled for **Leading**, down to one for **Silent**.

Under the trend line, a change of more than 1% either way shows an up or down arrow. A smaller change is shown without an arrow. Hover the line to see **Combined influence**, **Technical influence**, and **Ecosystem influence** changes separately.

The table starts sorted by **Contributors**, most first. Select a column heading to sort by it, and select it again to reverse the order. It shows 25 rows per page. When there are more than 25 projects, you can change that to 10 or 50 at the bottom of the table.

## What does the Health label mean?

The **Health** label is the project's health classification from LFX Insights. Hover or select the label to see the score and how it breaks down.

The panel shows the label, the score out of the most it can reach (100, or less for a partial score), and three categories:

| Category                    | Points |
| --------------------------- | ------ |
| **Maintainer Health**       | 40     |
| **Security & Supply Chain** | 35     |
| **Development Activity**    | 25     |

A label with an asterisk, such as **Healthy\***, is a partial score. One category has no data for that project, and the panel names it: **\*The Health score is partial because the** category **category is missing data for this project.** A category with no data shows a dash (**—**) in place of its score.

**Unavailable** means the project has no health score. The panel says **Health score is unavailable for this project.** When you sort by **Health**, projects with **Unavailable** come after the others in either direction.

## Why does a project say "No activity yet"?

**No activity yet** next to a project's name means the company has no influence data for that project. This happens when a project was added to a workspace but the company has no recorded involvement in it.

On that row, the project name is not a link. **Technical influence**, **Ecosystem influence**, and **Influence Trend (1y)** say **Unavailable**. **Contributors** and **Participants** are numbers you cannot select. **Health** can still show a label, because health is measured for the project, not for the company. These rows sort after the others when you sort by an influence or trend column.

## How do I filter the Projects table?

You filter the Projects table with the workspace, foundation, and employee menus above it, which choose the rows shown. **Company scope** and **Team members**, under **More filters**, change how the **Contributors** column counts. Each choice goes back to page 1.

1. Open the workspace menu at the left, which shows the current workspace's name, and select a workspace under **Shared Workspaces**.
2. Open the foundation menu. It starts on **All Foundations**. Type in **Search foundations…** to find one, and select it to keep only that foundation's projects.
3. Open **All Employees** and select one or more people to keep only the projects they maintain, contribute to, or participate in.
4. Select **More filters** to show **Company scope** and **Team members**. The link counts how many of the two are set to something other than their default, such as **More filters (1)**. Select **Fewer filters** to hide them again.

When maintainer data cannot be read, the page says **Maintainer data is currently unavailable — the Employees filter matches contributors and participants only.**

When the filters match no projects, the table says **No results for filters** and **Try a different workspace or clear your filters.** Select **Reset filters** to clear the workspace, foundation, employee, company scope, and team members choices at once.

## What does Company scope change?

**Company scope** chooses which of the companies count toward contributors. On the Projects page it **Applies to the Contributors column only.**

- **Insights company**, the default, counts only the company on the company's LFX Insights page, in the repositories LFX Insights counts. Maintainer roles are not affected.
- **All related companies** counts every company linked to the company account, such as subsidiaries, acquisitions, and duplicate records, in every repository. The number in parentheses is how many of those related companies have code activity in the past two years.

When the company has no LFX Insights company with code activity in the past two years, the menu is locked on **All related companies**. Its info button says **This company has no LFX Insights company with code activity in the past two years; counts include every related company.**

Your choice is kept when you open a project's detail page and when you return to Projects. See [Company scope](../../dashboards/#company-scope).

## What does Team members change?

**Team members** chooses whether people marked as team members in LFX count toward the **Contributors** column. It does not change any other column. Hovering the menu explains that LFX Insights leaves team members out of code contributions and maintainer roles, Company Lens does too by default, and seats, events and training are not affected.

- **Exclude team members**, the default, leaves them out, as LFX Insights does.
- **Include team members** counts them.

When **Exclude team members** is chosen but the team-member data cannot be read, the page says **Team-member data is unavailable; counts include team members.**

A project detail page has no **Team members** choice.

## How do I export the Projects table?

Select **Export to CSV** to download the projects the table currently shows, across every page. The file has the columns **Project**, **Health Score**, **Technical Influence**, **Ecosystem Influence**, **Influence Trend (1y) %**, **Our Contributors**, and **Our Participants**. It follows the current workspace, filters, and sort.

**Export to CSV** is unavailable while the table loads and when it has no rows. Its hover text is then **No rows to export**.

## What is a workspace?

A workspace is a named list of projects that the Projects table shows. Workspaces are shared: everyone who can open the company sees the same ones, and a change made by one person appears for everyone.

**All Projects with Activities** is the workspace every company starts with. It is filled with up to 50 of the company's projects, those with the most participating employees first. It cannot be deleted.

When the company has no recorded activity, the table says **No projects with activity yet** and **Projects will appear here once this company has activity in the catalog.** Someone who is not one of the company's Admins can also see this before any Admin has opened Projects, because an Admin's first visit is what fills **All Projects with Activities**.

## Who can manage workspaces and add projects?

Only people who can edit the selected company, such as its Admins, can add projects, hide projects, and add, rename, or delete workspaces. See [Manage Company Lens Access](../manage-company-lens-access/) for who is an Admin.

When you cannot edit the company, **Add Project** is unavailable and its hover text is **You have view-only access to this company**. The workspace menu has no settings button and no **Add workspace**, and rows have no actions menu. An empty workspace you are viewing says **No projects in this workspace yet** and **An administrator of this company can add projects to this workspace.**

**Add Project** is also unavailable while projects load, with the hover text **Projects are still loading**, and after a load error, with **Resolve the loading error first**.

## How do I add a project to a workspace?

You add projects from **Add Project**, which adds them to the workspace the table is showing. You must be able to edit the company, for example as an Admin.

1. Select the workspace in the workspace menu.
2. Select **Add Project**. The dialog title is **Add project(s)**. A note says **This will be shared across all users in your company.**
3. Type in **Search and select projects**. You can search any project in the LFX catalog, not only the ones the company is already involved in. Type at least 2 characters.
4. Select one or more projects.
5. Select **Add project(s)**. Select **Cancel** to close without adding.

While the search runs, the list says **Searching projects…**. When every match is already in the workspace, it says **Matching projects are already in this workspace.** When nothing matches, it says **No projects match your search.** When the search fails, it says **Couldn’t load matches. Edit your search to try again.**

When the projects could not be added, the dialog says **Could not add the selected projects. Try again.**

A new, empty workspace says **No projects in this workspace yet** and **Add projects from your company catalog to start tracking this workspace.** with an **Add Project** button.

## How do I hide a project from a workspace?

You hide a project from the actions menu at the end of its row. You must be able to edit the company, for example as an Admin. Hiding removes the project from that workspace only. It does not change the project or the company's activity in it.

1. Select the three-dot button at the end of the row. Its name is **Row actions**.
2. Select **Hide project from workspace**.

When it did not work, the page says **Could not update workspace** and **The project was not hidden from this workspace. Please try again.**

## How do I add, rename, or delete a workspace?

You manage workspaces from the workspace menu at the left of the filters. You must be able to edit the company, for example as an Admin.

1. Open the workspace menu.
2. To add one, select **Add workspace**. To change one, select the gear next to its name, labeled **Workspace settings**.
3. In **Workspace name**, type the name, such as the placeholder **e.g. Cloud Native focus**.
4. Select **Save**. To delete the workspace instead, select **Delete workspace**. **Delete workspace** is not offered for **All Projects with Activities**.

A new workspace opens as soon as it is saved, and it starts empty. After you delete the workspace you were viewing, the table switches to another workspace.

A blank name shows **Workspace name is required.** A save or delete that did not work shows **Could not create this workspace. Try again.**, **Could not save workspace changes. Try again.**, or **Could not delete this workspace. Try again.**

## What is a project detail page?

A project detail page shows how the selected company takes part in one project and how it compares with other companies there. You open it by selecting a project name on Projects. Its address is `/company/<company>/projects/<project>`.

You can also open it from a project in the [Company Overview dashboard](../company-overview/) and from the **Org Projects** panel on [Memberships](../memberships/#what-does-the-org-projects-panel-show).

The trail at the top reads **Projects** followed by the project name. Select **Projects** to go back to the list.

The top of the page shows the project's logo, name, and description, with **Source: LFX Insights** linking to the project's page on LFX Insights. To the right are four facts about the project. They do not change with the time range.

| Fact               | What it shows                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First commit**   | The month and year of the project's earliest commit on its main branch                                                                                  |
| **Software value** | An estimate, in US dollars, of what it would cost to build the project's code. Its hover text is **Based on Constructive Cost Model (COCOMO)**          |
| **Health score**   | The same health label as on Projects. Hover or select it to see the breakdown. See [What does the Health label mean?](#what-does-the-health-label-mean) |
| **Foundation**     | The Linux Foundation foundation the project belongs to, or **Outside LF** for a project that is not part of one                                         |

A dash (**—**) means the fact is not available for that project.

## How do I change what the project detail page shows?

You change a project detail page with the tabs, the time range, and, on **Leaderboards**, the metric choice, all in the bar under the project's summary. Each choice is kept in the page address, so a copied link opens the same view.

1. Select a tab: **Our Influence** or **Leaderboards**. **Our Influence** opens first.
2. Select a time range: **1 year**, **2 years**, or **All time**. **2 years** is the default. The time range applies to both tabs.
3. On **Leaderboards**, select **Calculated Influence** or **Activity Count** to choose what the leaderboards rank.
4. Select **More filters** to show **Company scope**.

On a project detail page, **Company scope** **Applies to contributor, commit and pull request counts, and to which leaderboard row is this company's.** Maintainer roles and health are the same under both choices. The band next to **Our Technical Influence** and **Our Ecosystem Influence** follows the chosen scope: under **Insights company** it is that company's own, and none is shown if it has no leaderboard rank on the project, even when a related company has one. Under **All related companies** it comes from the company's best-ranked company. See [What does Company scope change?](#what-does-company-scope-change).

## What does the Our Influence tab show?

The **Our Influence** tab shows the company's share of the project's activity, in two rows of cards: **Our Technical Influence** and **Our Ecosystem Influence**. The chip next to each heading is the company's band, such as **Leading**. Use the arrows at the right of a heading to scroll its cards.

Each card shows a chart of the company's activity over the time range, a headline figure, and a short sentence. For example, the **Commits** card can say **Employees made** a percentage **of all commits.** A card whose chart has no data points for the time range shows **No data** in place of its chart. A recorded zero is still data, so a period with no activity draws a chart at zero.

| Card                       | Group     | What it counts                                                                                                              |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Maintainer roles**       | Technical | People named as maintainers in the project's governance files, counted once per project, credited to their current employer |
| **Contributors**           | Technical | Individuals who made at least one contribution (commit, PR, review, or comment) in the selected time range                  |
| **Commits**                | Technical | Code contributions committed directly to the project's repositories                                                         |
| **Pull Requests Opened**   | Technical | Pull requests opened against the project's repositories in the selected time range                                          |
| **Avg Time to Merge PRs**  | Technical | Average time from when a pull request is opened to when it is merged, for the company's contributors, compared with average |
| **Collaboration Activity** | Ecosystem | Interactions across collaboration platforms including Slack, mailing lists, GitHub Issues, Jira, and community forums       |
| **Meeting Attendance**     | Ecosystem | Attendance at project committee, working group, and community meetings                                                      |
| **Board Members**          | Ecosystem | Seats on the governing board of the project's foundation                                                                    |
| **Committee Members**      | Ecosystem | People on a foundation committee, such as advisory groups, steering committees, and marketing committees                    |
| **Event Attendance**       | Ecosystem | Registration and attendance at events hosted or co-located with the project's foundation                                    |
| **Event Speakers**         | Ecosystem | Employees who presented talks, workshops, or keynotes at foundation-hosted events                                           |
| **Event Sponsorships**     | Ecosystem | Events where the company sponsored, co-sponsored, or provided in-kind support                                               |
| **Meetup Attendance**      | Ecosystem | Attendance at community meetups organized under the project's foundation                                                    |
| **Certified Individuals**  | Ecosystem | Employees who hold active certifications issued or recognized by the project's foundation                                   |

A project outside the Linux Foundation has no ecosystem cards. Its ecosystem chip says **Non-LF**, and the row says **No ecosystem influence data for this project yet.**

### What happens when I select a card?

Selecting a card opens a panel with the full detail for that metric. The panel title is the card's name. The line under it names the time range, such as **Last 24 months** or **All time**, and what the card covers: the project or foundation name on ecosystem cards, and **All projects** on technical cards.

The panel shows the headline figure, then a table with **Definition**, **Total count for this project** (or **Average for this project**), and **Data source**. Under it is a list of the company's people or activity for that metric, such as each contributor with **First activity**, **Most recent**, and **# Contributions**. Select a person's name to open their details.

When the metric has nothing to list, the panel says **No data available for this metric.** When it fails to load, it says **Failed to load details** and **Please try again.** Select **Retry**.

## What does the Leaderboards tab show?

The **Leaderboards** tab ranks the companies involved in the project, side by side for technical and ecosystem activity, with an influence trend chart under them. The selected company's row is highlighted and marked **You**.

What the leaderboards rank depends on the metric you choose:

| Metric                   | Technical board                                                       | Ecosystem board                                                         |
| ------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Calculated Influence** | **Technical Influence Leaderboard**, with an **Influence Score** band | **Ecosystem Influence Leaderboard**, with an **Influence Score** band   |
| **Activity Count**       | **Contribution Activities Leaderboard**, with **Total contributions** | **Collaboration Activities Leaderboard**, with **Total collaborations** |

Each board has the columns **#**, **Company**, and the score. Type in **Search** above a board to find a company by name. The boards show 10, 25, or 50 rows per page.

With **Calculated Influence**, select a row to open that company's score breakdown, with its **Total score** and **How this score is calculated**. **Activity Count** rows do not open a breakdown. See [What does a leaderboard score breakdown show?](#what-does-a-leaderboard-score-breakdown-show).

When a board has no rows, it says **No ranked companies for this project yet.** When a search matches nothing, it says **No companies match your search.** For a project outside the Linux Foundation, the ecosystem board is marked **Non-LF**.

### What does the Influence Trend chart show?

**Influence Trend** shows how the project's combined influence is shared among companies over the time range. Each band is one of the 10 companies with the most influence, and **All others** adds up the rest, so the bands always total 100%. When there is no trend to show, it says **No data available.**

## What does a leaderboard score breakdown show?

A score breakdown shows how one company earned its influence score on the project, category by category. It opens when you select a row on the **Technical Influence Leaderboard** or the **Ecosystem Influence Leaderboard**, which are the boards shown with **Calculated Influence**. On a keyboard, move to a row and press Enter or Space. It follows the page's time range and **Company scope**.

1. The panel's title is the company's name. The line under it names the project and **Technical Influence** or **Ecosystem Influence**.
2. A summary sentence gives the company's band and score, such as **Acme has a Contributing technical influence in Kubernetes and a score of 6.25**. When they are known, it also gives the company's share of the project's contribution activity (technical) or collaboration activity (ecosystem), and its rank, such as **#3 out of 120 companies participating in the project**.
3. A list of categories, introduced by **The % of** the company's **score that each category contributes, and the points it earned**. Each category shows its points and a bar for its share of the total score, highest points first. Most also show the company's count, or its count against the project's or the foundation's total, depending on the category, such as **(12 of 340)**.
4. **Total score**: the sum of the points. It is the same score as the leaderboard row.
5. **How this score is calculated**: how each category earns points, and how the score maps to a band.

The technical score has four categories: **Maintainer roles**, **Contributors**, **Commits** and **PRs Opened**. The ecosystem score has ten: **Collaboration Activities**, **Meeting Attendance**, **Event Attendance**, **Committee Members**, **Board Members**, **Event Speakers**, **Meetup Attendance**, **Event sponsorship - attendees reached**, **Certified Individuals** and **Membership Tier**. A category marked **(not tracked for this project)** has no activity recorded for the project at all. **Membership Tier** has no count: its points come from the company's Linux Foundation membership tier.

### Why are some categories locked?

Four ecosystem categories, **Meeting Attendance**, **Event Attendance**, **Meetup Attendance** and **Certified Individuals**, come from individual participation records that LFX does not publish. You see their figures only in your own company's breakdown, the row highlighted and marked **You**. In any other company's breakdown they are listed last with a lock in place of their points, and the panel says **Locked categories are based on individual participation records that LFX does not publish.** Their points are still part of that company's **Total score**. Technical categories are never locked.

### How are the points calculated?

Each category earns points on its own, with no preset weights, and the points are added up to the total score.

| Score     | Categories                                                                                                        | Points                                                                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Technical | **Maintainer roles**                                                                                              | 10 points when the company has maintainers on the project in the time range. Only companies with code contributions in that range are scored, so a company can hold maintainer roles and still earn 0 points |
| Technical | **Contributors**, **PRs Opened**                                                                                  | 0.1 point for each 0.1% share of the project's total, plus 1 point for any share above 0%                                                                                                                    |
| Technical | **Commits**                                                                                                       | Scored like Contributors, but from all commit credit, including co-authored commits. The count and share shown are authored commits only, so a company can show 0 authored commits and still earn points     |
| Ecosystem | **Collaboration Activities**, **Meeting Attendance**, **Committee Members**, **Event Speakers**                   | 0.1 point for each 0.1% share of the project's or foundation's total, plus 1 point for any share above 0%                                                                                                    |
| Ecosystem | **Board Members**                                                                                                 | 1 point when the company has at least one board member on the project's foundation                                                                                                                           |
| Ecosystem | **Event Attendance**, **Meetup Attendance**, **Certified Individuals**, **Event sponsorship - attendees reached** | 0, 0.33, 0.66 or 1 point for no share, a share up to 25%, up to 50%, or over 50%                                                                                                                             |
| Ecosystem | **Membership Tier**                                                                                               | 1 point for Premier, 0.66 point for Strategic, otherwise 0                                                                                                                                                   |

The count next to **Maintainer roles** is the maintainer roles the company holds on the project against every company's roles, with people marked as team members in LFX left out. It is counted separately from the points.

The total score maps to a band:

| Band              | Technical score | Ecosystem score |
| ----------------- | --------------- | --------------- |
| **Silent**        | 0               | 0–2             |
| **Participating** | 1–4             | 3–10            |
| **Contributing**  | 5–14            | 11–19           |
| **Leading**       | 15 or more      | 20 or more      |

### What if the breakdown does not load?

- **This breakdown could not be loaded. Close the panel and try again.** The request failed. Close the panel and select the row again.
- **A detailed breakdown is not available for this company.** There is no breakdown on record for that company on this project.

## Why did Projects or a project detail page fail to load?

When Projects or a project detail page fails to load, it shows a message naming what failed, usually with **Retry**. A failed load is not the same as an empty list.

| What you see                                    | Where             | What to do                                                           |
| ----------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| **Could not load your saved workspaces.**       | Projects          | Select **Retry** to restore the workspaces                           |
| **Something went wrong loading your projects.** | Projects          | Select **Retry**. Your workspaces are still available                |
| **Could not load projects for this workspace**  | Projects          | Select **Retry**, or add the projects to the workspace again         |
| **Project not found**                           | Project detail    | The project is not one of the company's. Select **Back to Projects** |
| **Failed to load project detail**               | Project detail    | Select **Retry**                                                     |
| **Failed to load influence cards**              | **Our Influence** | Select **Retry**                                                     |
| **Failed to load leaderboard**                  | **Leaderboards**  | Select **Retry** on that board                                       |
| **Failed to load influence trend**              | **Leaderboards**  | Select **Retry** under **Influence Trend**                           |

**Project not found** comes with **We couldn't find that project for your company.** The other project detail failures come with **Please try again.**

## Related sections

- [Choose and switch a company](../choose-a-company/) — pick the company these projects belong to
- [Company Overview dashboard](../company-overview/) — the **Dashboard**, whose project links open a project detail page
- [Memberships](../memberships/) — the company's foundation memberships, and the **Org Projects** panel for each one
- [Manage Company Lens Access](../manage-company-lens-access/) — who is an Admin, and who can manage workspaces
- [EasyCLA](../easycla/) — corporate CLAs (Contributor License Agreements) for the selected company
- [Company FAQ](../faq/) — short answers about the Company lens
