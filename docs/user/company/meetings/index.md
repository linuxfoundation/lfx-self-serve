---
title: Company Meetings
description: How to read the Company lens Meetings page — how many of the company's employees attend Linux Foundation project meetings, where they spend that time by foundation, project, meeting type and role, how attendance adds to the company's influence on each project, and the time range.
audience: [all]
product_area: Company
tags: [company, org, org-lens, meetings, attendance, influence, ecosystem-influence, time-range]
last_updated: 2026-11-06
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **Meetings**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

This article covers the company's **Meetings** page in the Company lens. Your own meetings, which you join and manage, are covered in [Meetings](../../meetings/).

## What is the Company lens Meetings page?

The Company lens Meetings page shows how the selected company's employees take part in Linux Foundation project meetings over a time range: how many attend, where they spend that time, and how their attendance adds to the company's influence on each project. Its address is `/org/<company>/meetings`.

The page heading is **Meetings**, and the line under it is **How your company's employees engage across Linux Foundation projects.** The page shows totals for the company only. It does not list people or individual meetings.

The page has three sections, from top to bottom:

1. Four cards with the company's meeting totals.
2. **Where your people spend time**, which breaks the company's meeting attendance down.
3. **How attendance impacts project influence**, a table of projects.

Only meetings scheduled in LFX are counted. Communities that run their meetings elsewhere, such as Kubernetes, are not included.

## How do I open the Company lens Meetings page?

You open **Meetings** from the Company lens sidebar, under **Company Engagement**, once a company is selected.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. In the sidebar, under **Company Engagement**, select **Meetings**. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Meetings** in it.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, the page is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-an-company).

## How do I change the time range on Meetings?

You change the time range with the date menu next to the page heading. It changes all three sections.

1. Select the date menu. It shows the current range, **Past 365 days** by default.
2. Select a range: **Past 90 days**, **Past 180 days**, **Past 365 days**, **Previous quarter**, **Previous year**, **Previous 5 years** or **Previous 10 years**. Each option shows the dates it covers.

The range is not kept in the page address, so the page opens on **Past 365 days** each time.

## What do the cards on Meetings count?

The four cards count the selected company's meeting activity in the time range, and each one compares it with the prior period.

| Card                      | What it counts                                |
| ------------------------- | --------------------------------------------- |
| **Employees Active**      | The company's employees who attended meetings |
| **Meetings Attended**     | Meetings those employees attended             |
| **Projects Supported**    | Projects whose meetings they attended         |
| **Foundations Supported** | Foundations whose meetings they attended      |

With each number, the change shows as a percentage, such as **+12% vs. prior period**. It says **No change vs. prior period** when the number is unchanged, and **New** when there was nothing in the prior period.

## What does Where your people spend time show?

**Where your people spend time** shows how the company's meeting attendance in the time range is split, as a percentage of all of its employees' attendances. It has up to four cards:

- **By foundation**
- **By project**
- **By meeting type**
- **By role**

Each card shows its total number of attendances and a bar for each value with its percentage. A card with nothing to show is left out. The smaller values are combined into one row at the bottom of a card. Point at or select that row to see what it combines, under **Breakdown**. When there are too many to name, the list ends with **+N more**.

## What does How attendance impacts project influence show?

**How attendance impacts project influence** lists the projects where the company has a published Ecosystem Influence Score, and how much of the influence shown for each one comes from its employees' meeting attendance. The page shows the score's activity measures only, not its membership-tier part, so every share on this table is a share of the measures shown, not of the whole score. Ecosystem influence is the company's influence on a project's non-code collaboration, such as documentation, committees, meetings and events.

| Column                        | What it shows                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**                   | The project's name                                                                                                                                                                                                      |
| **Rank among companies**      | The company's rank, such as **#2 of 15**, among the companies that contributed code or attended meetings on the project in the time range. Point at or select it for what the rank compares                             |
| **Ecosystem Influence**       | The company's influence level on the project: **Leading**, **Contributing**, **Participating** or **Silent**                                                                                                            |
| **Attendance's contribution** | The share of the measures shown that comes from meeting attendance, such as **12% of score**. It leaves out the membership-tier part of the score. The bar is scaled for legibility; the percentage is the actual share |
| **Δ vs. prior period**        | How the company's score changed from the prior period, such as **+5.2%**, **No change**, **New**, or **No comparable prior period** when there is no earlier score                                                      |

Select **Projects** at the end of a row to open that project's page in the Company lens.

Select a row to expand it. The expanded row breaks the influence shown down into the measures behind it, with the share of each, and highlights meeting attendance. **Board Members (all time)** and **Committee Members (all time)** count standing seats over all time, so they change little with the time range. A sentence under the breakdown gives the same share as a number of influence points, out of the points shown for the project in the period.

Because a project appears only once it has a published Ecosystem Influence Score, this list can be shorter than the projects in **By project**. The page says so under the table.

## Why is a section on Meetings empty, or why did it fail to load?

Each section loads on its own, so one section can be empty or fail while the others show. An empty section is not the same as a failed load.

| What you see                                                                        | What it means                                                                    | What to do                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **No meetings in this period**, or **No influence scores in this period**           | The company has nothing recorded for the time range                              | Pick a wider time range, or select **Reset filters** to go back to **Past 365 days** |
| **This section could not be loaded**                                                | That section did not load. The rest of the page is unaffected                    | Select **Retry**                                                                     |
| **Select a company to view meeting insights.**                                      | No company is selected                                                           | Select a company in the switcher                                                     |
| **Meeting insights aren't available for this company right now. Please try again.** | The company's meeting data could not be matched to it                            | Reload the page later                                                                |
| **Access could not be verified**                                                    | Your access to the company could not be checked. Your permissions did not change | Select **Retry**                                                                     |

**Reset filters** shows only when the time range is not the default.

## Related sections

- [Projects and project detail](../projects/) — each project's page, with the company's influence cards
- [Org Overview dashboard](../company-overview/) — the **Meetings This Week** tile and the **Governance Participation** column
- [Groups](../groups/) — the working groups and committees where the company's employees hold seats
- [Meetings](../../meetings/) — your own meetings, which you join and manage
- [Company FAQ](../faq/) — short answers about the Company lens
