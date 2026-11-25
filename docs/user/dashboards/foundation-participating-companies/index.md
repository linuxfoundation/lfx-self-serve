---
title: Foundation Participating Companies
description: See which companies contribute across a foundation's projects, split by foundation membership, with per-project breakdowns and CSV export.
audience: [executive-director]
product_area: Dashboards
tags: [dashboard, foundation, participating-companies, contributors, members]
last_updated: 2026-11-19
intercom_collection: Dashboards
---

**Participating companies** (`/foundation/participating-orgs`) lists every company contributing to a foundation's projects, ranked by activity and split by foundation membership. It is under **Metrics** in the Foundation lens. Executive directors of the foundation and LF Staff can open it; other roles don't see it.

## What the page shows

- **Summary cards** — contributing companies, foundation members (with how many of them contributed), non-members, and the share of commits that came from member companies.
- **Table** — one row per company with its membership tier, commits, contributors, and the change from the previous period. Select a column heading to sort.
- **Tabs** — **All**, **Members** and **Non-Members**. The summary cards don't change with the tab.

## Filter the data

- **Search** by company name.
- **Tier** narrows the list to members of one tier. It doesn't apply on the Non-Members tab.
- **Range** picks the period: 12 months, 90 days, 30 days or all time.
- **Project** scopes the table, the cards and the exports to one project. The **Members** card still counts the whole foundation's members and notes how many contributed to the selected project.

Active filters appear as chips above the table. Select **Clear all** to remove them.

## See a company's projects

Open a row to see the projects behind its totals, largest first, with each project's commits, contributors, change and share of the company's commits. A company active in more than 10 projects shows its top 10 and an **Other N projects** row that gives only the count. Use the filter box or **Show all** to see the rest.

Project figures come from the warehouse's roll-ups, so a parent project and its child project can both include the same activity. Don't add project lines together: the company's total in the table is the reliable figure.

## Export to CSV

Use **Export** and choose:

- **Company summary** — one row per company, with foundation totals, or the selected project's figures when a project is selected.
- **Companies by project** — one row per company and project. Companies with no project-level activity are left out.

The file name includes the foundation, the project (if selected), the range and the date. If a file would be very large it holds the first rows and the page tells you it was truncated.

## Related

- [Navigate your dashboards](../navigate-dashboards/)
- [Foundation Health Metrics](../foundation-health-metrics/)
