---
title: Groups
description: How to read the Company lens Groups page — the working groups, committees and other groups where the company's employees hold seats, the type tiles, how to search and filter the list, see who holds the seats, and export it to CSV.
audience: [all]
product_area: Company
tags: [company, org, org-lens, groups, committees, working-groups, seats, seat-holders, export, csv]
last_updated: 2026-11-06
intercom_collection: Company
---

These steps apply to anyone who can open a company in the Company lens, such as a company admin (editor or viewer). A CLA (Contributor License Agreement) Manager or initial CLA Manager designee (the person nominated to sign the company's corporate CLA and become its first CLA Manager) with no other role on a company sees only its **EasyCLA** page, not **Groups**. To pick the company the page shows, see [Choose and switch a company](../choose-a-company/).

## What is the Groups page?

The Groups page lists the groups across Linux Foundation projects where the selected company's employees hold seats, such as working groups, committees and special interest groups (SIGs), with how many of its people sit on each one. Its address is `/org/<company>/groups`.

The page heading is **Groups —** followed by the company's name, and the line under it is **Where your employees hold seats across Linux Foundation projects.** Groups in the **Board** category, a foundation's governing board, are not listed here: those seats are on the company's [Memberships](../memberships/) page.

Each row in the list shows:

- The group's name, and under it the foundation or project it belongs to. When the foundation is a link, select it to open that membership on **Memberships**.
- The group's type, such as **Working Groups** or **SIGs**.
- How many of the company's people hold a seat in it. Select the number to see who they are.

Select anywhere else on a row to open the group's own page. The list starts with the groups where the company holds the most seats.

## How do I open Groups?

You open **Groups** from the Company lens sidebar, under **Company Engagement**, once a company is selected.

1. Sign in to [app.lfx.dev](https://app.lfx.dev).
2. Select **Company** in the lens switcher.
3. In the sidebar, under **Company Engagement**, select **Groups**. On a phone or small screen, selecting **Company** in the navigation menu only shows that lens's menu: select **Groups** in it.

If your only role on that company is CLA Manager or initial CLA Manager designee, you land on its **EasyCLA** page instead. See [Where do I find EasyCLA?](../easycla/#where-do-i-find-easycla).

When you cannot open the company, the page is replaced by the same access message as the other Company lens pages, such as **You do not have access to this company**. Those messages are covered in [What happens when a link does not open a company?](../choose-a-company/#what-happens-when-a-link-does-not-open-an-company).

## What do the tiles on Groups count?

The tiles count the groups in the list and the seats the company's people hold in them. Groups has no time range: it shows the seats the company's people hold now.

| Tile             | What it counts                                               |
| ---------------- | ------------------------------------------------------------ |
| **Total Groups** | The groups where the company's people hold at least one seat |
| **Total Seats**  | The seats they hold across all of those groups               |

A tile follows for each group type that has at least one group, largest first: **Boards**, **Oversight**, **Working Groups**, **SIGs** and **Ambassadors**, with **Other** always last. **Other** covers groups that fit none of those types. **Boards** covers board-like groups outside the **Board** category, such as an advisory council.

The tiles always count every group, whatever you search or filter.

## How do I search and filter the Groups list?

You narrow the list with the search box and the two menus above it.

1. Type in **Search groups...** to find a group by its name or by the name of its foundation.
2. Open the foundation menu, which starts on **All foundations**, and select a foundation.
3. Open the type menu, which starts on **All types**, and select a type. Each type shows how many groups it has, such as **Working Groups (4)**.

The line above the list says how many groups match, such as **Showing 4 of 12 groups**. Once you search or filter, select **Clear filters** next to it to clear the search and both menus. The search and menus are kept in the page address, so a copied link opens the same view, and they are cleared when you switch to another company.

## How do I see who holds the seats in a group?

Select the seat count on a group's row to open its seat holders.

1. Select the number on the right of the row. A panel opens with the group's name and its number of seat holders.
2. Read the list. Each seat holder shows their name, their role in the group, and their voting status, such as **Non-voting**.
3. Select a person's name to open their details, or select **View group page** to open the group's own page.

A seat holder with no name is shown by email address, and one with neither is shown as **Unknown member**. If the panel cannot load, it says **Unable to load seat holders.** with **Try again**. If nobody is found, it says **No seat holders found for this group.**

## How do I export the Groups list?

Select **Export to CSV** to download the list as a CSV (comma-separated values) file, which opens in a spreadsheet. The file holds the groups the list currently shows, after the search and filters, in the same order.

The file has the columns **Group**, **Foundation**, **Type**, **Our Seats** and **Group UID**. When no group matches, the button is disabled and says **No rows to export**.

## Why is the Groups page empty, or why did it fail to load?

An empty list says why, and a failed load says so. An empty list is not the same as a failed load.

| What you see                                                                                              | What it means                                                     | What to do                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- |
| **No group participation found.** — **Your company's employees are not listed as members of any groups.** | The company's people hold no seats outside the **Board** category | Board seats are on **Memberships** |
| **No groups match the current filters**                                                                   | The search or menus match no group                                | Select **Clear filters**           |
| **Unable to load group participation**                                                                    | The list did not load                                             | Refresh the page                   |
| **Select a company to view group participation.**                                                         | No company is selected                                            | Select a company in the switcher   |

## Related sections

- [Memberships](../memberships/) — the company's foundation memberships, with its governing board and committee seats
- [People](../people/) — the **Board** and **Committee** tabs list the people who hold seats
- [Company Meetings](../meetings/) — how the company's employees take part in project meetings
- [Choose and switch a company](../choose-a-company/) — pick the company the page shows
- [Company FAQ](../faq/) — short answers about the Company lens
