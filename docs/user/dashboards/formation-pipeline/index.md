---
title: Formation pipeline
description: See every project the formation team is bringing into The Linux Foundation, by stage, and filter, sort and export the list.
audience: [all]
product_area: Dashboards
tags: [formation, pipeline, formations, stages, draft, exploratory, engaged, on hold, archived, formation lead, foundation, csv, export]
last_updated: 2026-11-12
intercom_collection: Dashboards
---

The **Pipeline** tab lists every project the formation team is bringing into The Linux Foundation, one row per project, by stage. It is for formation team members only.

## Who can see it

Formation team members see the **Pipeline** tab on the **Formations** page when The Linux Foundation is the selected foundation. It is the first tab and the one that opens by default. Everyone else sees the Formations page without it, and the page behind it refuses the request. The Formations feature must also be enabled for your account.

To go back to the original list, select the **Formations** tab. Select **Pipeline** again to return.

## What you see

Each row is a project that has not become Active yet, or that has left the pipeline:

| Column                | What it shows                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Project**           | The project name, with its foundation underneath. The foundation is the nearest foundation above the project, which is not always its direct parent.                                                                                                   |
| **Stage**             | **Draft**, **Exploratory**, **Engaged**, **On hold**, **Disengaged** or **Archived**.                                                                                                                                                                  |
| **Expected launch**   | The announcement date, with how far away it is, such as **In 8 days** or **In 9 weeks**. A launch within 30 days is amber. A past date on a project that is not Archived reads **Overdue**, also in amber. **Not set** means no date has been entered. |
| **Formation lead**    | The formation lead for the project. Hover over the name, or tab to it, to see the email. **Not set** means no lead has been entered yet. Leads fill in as the formation lead field is rolled out.                                                      |
| **Formation date**    | When the project was formed, if set.                                                                                                                                                                                                                   |
| **Legal entity**      | The legal entity name, if set.                                                                                                                                                                                                                         |
| **ED / PM**           | The executive director and the program manager. **Not assigned** and **No PM yet** mean the role is empty.                                                                                                                                             |
| **Opportunity owner** | The opportunity owner, if set.                                                                                                                                                                                                                         |
| **Updated**           | How long ago the project was last updated.                                                                                                                                                                                                             |

The test projects used for development, and anything under them, are left out of the list, the counts and the export.

Select a column heading to sort by it. Select it again to reverse the order. The list opens sorted by **Expected launch**: upcoming dates first, then past dates, then **Not set**.

Select a project name to open it. A project opens its formation page. If the project has nothing to track yet, the page says so, and formation items start when the project moves into a formation stage. An Archived project opens its project dashboard.

## Stages and the stage pills

The pills above the list choose which stages you see:

- **In pipeline** is the default. It shows the projects the team is actively working: **Draft**, **Exploratory**, **Engaged** and **On hold**.
- **All** shows every stage, including **Disengaged** and **Archived**.
- **Draft**, **Exploratory**, **Engaged**, **On hold**, **Disengaged** and **Archived** each show one stage. The number in brackets is how many projects are in it. **Disengaged** and **Confidential** appear only when they have projects.

**Draft** is the name the formation team uses for a project that has been created but not yet explored. The **Formations** tab and the formation record use the same name. The **Archived** card reads **No longer active**: many archived projects launched before they were archived.

The cards above the pills show the same stages. Select a card to filter by that stage, and select it again to return to **In pipeline**. The **Engaged** card also tells you how many launch in the next 30 days.

## Filter and search

- **Foundation** narrows the list to one foundation and everything beneath it. The choices come from the foundations your projects sit under. Select **All foundations** to clear it. The counts on the pills and cards follow the foundation.
- **Foundation type** narrows the list by the project's direct parent. **Directly under LF** projects have The Linux Foundation as their parent, which is where new foundations and directed funds sit. **Under an existing foundation** projects have another project as their parent. **No parent yet** projects have none. Select **All projects** to clear it. The counts follow it, and it works together with the stage, foundation and search.
- **Search projects** matches part of a project name, whatever the case. The counts follow your search.

If your filters hide every project, the list says so and offers **Reset filters**.

Your stage, foundation, foundation type, search and sort are kept in the page address, so you can bookmark a view or send the link to a colleague and they see the same list. Leaving the **Pipeline** tab clears them.

## Export the list as a CSV

Select **Export CSV** to download the projects you are looking at, across all pages, with the same columns in the same order. The file is named `formation-pipeline-` followed by today's date. **Formation lead** is one column, and **ED** and **PM** are separate columns in the file. It opens in Excel with names in any language.

## On a phone

Below 600 pixels wide the table becomes a list of cards, with the stage pills scrolling sideways. Each card shows the stage, expected launch, formation lead and ED / PM. Select **Load more** to see further projects. **Export CSV** is an icon button.
