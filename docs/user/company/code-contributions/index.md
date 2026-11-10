---
title: Code Contributions
description: How to read the Code Contributions page for the selected company — its repositories and commits, what All code contributions, All commits and Only main branch commits count, how to filter it, and how the time range carries to People.
audience: [all]
product_area: Company
tags: [company, org, org-lens, code-contributions, contributions, commits, repositories, time-range, team-members, company-scope]
last_updated: 2026-11-06
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **Code Contributions**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

## What is the Code Contributions page?

The Code Contributions page shows the selected company's code contributions to open source projects over a time range: which repositories its contributors worked in, how much they contributed, and each of their commits. Its address is `/company/<company>/contributions`.

The page heading is **Code Contributions**. The line under it is **Commits, contributors, and collaborators across your projects.** Three cards at the top count:

| Card                       | What it counts                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Projects with Activity** | Projects the company's contributors contributed code to in the time range                                                                                                  |
| **Repositories**           | Repositories they contributed code to                                                                                                                                      |
| **Code contributions**     | Their code count. It says **Commits** when you count commits. See [the code count options](#what-do-all-code-contributions-all-commits-and-only-main-branch-commits-count) |

The sentence under the cards states exactly what is counted, for whom, and over which dates, such as **Code contributions (commits, pull requests, reviews and comments) by contributors affiliated with** the company **in LF and non-LF projects, from** a start date **to** an end date **(UTC).** It also names the company scope, and ends **Bots excluded.** Hover or select the info icon next to it for the definition of the count.

## How do I open Code Contributions?

You open **Code Contributions** from the Company lens sidebar, under **Company Engagement**, once a company is selected. A CLA Manager or initial CLA Manager designee with no other role on that company is sent to **EasyCLA** instead.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. In the sidebar, under **Company Engagement**, select **Code Contributions**. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Code Contributions** in it.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, Code Contributions is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-a-company).

## What do the Repositories and Commits tabs show?

The **Repositories** tab lists each repository the company's contributors contributed to, and the **Commits** tab lists their individual commits. Each tab's name ends with how many rows it has, in brackets. Both follow the same filters.

The **Repositories** tab has these columns:

| Column                 | What it shows                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| **Project**            | The project the repository belongs to                                                               |
| **Repository**         | The repository's path. When it is a link, it opens the repository on its source site                |
| **Source**             | Where the repository is hosted: **GitHub**, **GitLab**, **Gerrit** or **Git**                       |
| **Code contributions** | The company's code count in that repository. It says **Commits** when you count commits             |
| **First contribution** | The date of the company's first contribution there. It says **First Commit** when you count commits |
| **Last contribution**  | The date of the most recent one. It says **Last Commit** when you count commits                     |

It starts sorted by the code count, most first. Select the count or a date heading to sort by it, and select it again to reverse the order.

The **Commits** tab has the columns **Project**, **Committer**, **Username**, **Date** and **Commit**. It starts with the newest commit first. Select **Project**, **Committer**, **Username** or **Date** to sort. When a committer's name is a link, select it to open their details. When the username and the commit message are links, they open the person's profile and the commit on the source site.

Both tabs show 10 rows per page. You can change that to 25 or 50 at the bottom of the table.

## What do All code contributions, All commits and Only main branch commits count?

The code count chooses what the page counts. It is under **More filters**, and **All code contributions** is the default.

| Option                       | What it counts                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **All code contributions**   | **Commits, pull requests, reviews and comments, counted as activities. Bots excluded.**                                           |
| **All commits**              | **Commits the person authored, on any branch (including pull-request commits not yet merged), counted once each. Bots excluded.** |
| **Only main branch commits** | **Commits the person authored that landed on the main branch, counted once each. Bots excluded.**                                 |

Under **All commits** or **Only main branch commits**, the column and card headings say **Commits**, **First Commit** and **Last Commit**. The same choice is on the **All Employees** and **Contributors** tabs of [People](../people/).

## How do I filter Code Contributions?

You filter Code Contributions with the search box and menus above the table. Each choice applies to both tabs and goes back to page 1, and it is kept in the page address, so a copied link opens the same view.

1. Type in **Search repositories** on the **Repositories** tab, or **Search commits** on the **Commits** tab. On **Commits** it matches the message, project, committer and username.
2. Select a time range: **Past 30 days**, **Past 90 days**, **Past 365 days**, **Past 2 years** or **All time**. **Past 2 years** is the default.
3. Select a project type: **LF and non-LF projects** (the default), **LF projects** or **Non-LF projects**. LF projects are Linux Foundation (LF) projects.
4. Open the foundation menu, which starts on **All Foundations**, and select a foundation. The project menu then lists only that foundation's projects.
5. Open the project menu, which starts on **Any project**, and select up to 50 projects.
6. Open **All Employees** and select up to 50 people to see only their code.
7. Select **More filters** to show the code count, **Team members** and **Company scope**. The link counts how many of them are set to something other than their default, such as **More filters (1)**.
8. Select **Clear filters** to put every filter back to its default, the time range included. It shows once a filter is changed.

When you switch to another company, the people you picked under **All Employees** are cleared.

## What do Team members and Company scope change on Code Contributions?

**Team members** and **Company scope**, under **More filters**, change whose code is counted, so they change the cards and the rows on both tabs.

- **Team members** chooses whether people marked as team members in LFX are counted. They are left out by default, as LFX Insights does. Choose **Include team members** to count them. When that data cannot be read, the page says **Team-member data is unavailable; counts include team members.**
- **Company scope** chooses which of the companies count. **Insights company**, the default, counts only the company shown on the company's LFX Insights page, in the repositories LFX Insights counts. **All related companies** counts every company linked to the company account, in every repository.

See [Company scope](../../dashboards/#company-scope) on the Dashboard page, which also covers **Team members**.

## Does the time range carry from Code Contributions to People?

Yes. The time range you pick on Code Contributions carries to **People** when you open it from the sidebar, and back again. **Company scope** and **Team members** carry the same way.

- On People, the time range applies to the tabs that have one: **All Employees**, **Contributors**, **Event Attendees** and **Trainees**.
- Project type, the code count, the foundation, and the employee picks do not carry to **People**. It opens on its own defaults for those.
- **Clear filters** puts the time range back to **Past 2 years**, so **People** then opens on **Past 2 years** too.

See [People](../people/) for that page.

## Why is Code Contributions empty, or why did it fail to load?

When the filters match nothing, the table says so. When the page fails to load, it says **Failed to load code contributions** and **Please try again.** Select **Retry**. An empty table is not the same as a failed load.

| What you see                                     | What it means                            | What to do                                                        |
| ------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------- |
| **No repositories match your filters**           | No repository has code for these filters | Select **Clear filters**, or choose a longer time range           |
| **No commits match your filters**                | No commit matches these filters          | Clear the search, or choose a longer time range                   |
| **Failed to load code contributions**            | The page could not load                  | Select **Retry**                                                  |
| **Select a company to view code contributions.** | No company is selected                   | Pick one; see [Choose and switch a company](../choose-a-company/) |

## Related sections

- [People](../people/) — the company's employees, contributors and maintainers, with the same time range
- [Projects and project detail](../projects/) — each project's contributors and the company's influence on it
- [Choose and switch a company](../choose-a-company/) — pick the company this page shows
- [Company Overview dashboard](../company-overview/) — the **Dashboard**, with the company's **Active Contributors**
- [Company FAQ](../faq/) — short answers about the Company lens
